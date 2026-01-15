from typing import Any, Dict, List

import numpy as np
from hypha_rpc.utils.schema import schema_method
from pydantic import Field, BaseModel, ConfigDict
from ray import serve


@serve.deployment(
    ray_actor_options={
        "num_cpus": 4,
        "num_gpus": 2,  # Request 2 GPUs for training
        "memory": 16 * 1024 * 1024 * 1024,
    },
)
class CellSegmenter:
    model_config = ConfigDict(arbitrary_types_allowed=True)
    
    def __init__(self):
        # Training state
        self.fit_task = None
        self.fit_result = None
        self.fit_error = None
        self.fit_cancelled = False
        
        # Model state - microSAM
        self.predictor = None
        self.segmenter = None
        self.model_type = "vit_b_lm"
        self.device = "cuda" if self._check_cuda() else "cpu"
        self.is_tiled = False  # Track current tiling state
        
        # Model state - Cellpose
        self.cellpose_model = None
        
        # Initialize checkpoint directory
        import os
        # Use absolute path to project's checkpoint directory
        # Since __file__ is not available in Ray Serve context, use a hardcoded path
        self.checkpoint_dir = "/home/scheng/workspace/ddls2025-microsam-u2os/models/checkpoints"
        os.makedirs(self.checkpoint_dir, exist_ok=True)
        self.current_checkpoint = None
        
        # NOTE: Models are loaded lazily on first use to avoid unnecessary imports
        # - microSAM: loaded when method="microsam" is used
        # - Cellpose: loaded when method="cellpose" is used
    
    def _check_cuda(self):
        """Check CUDA availability without importing torch at module level."""
        try:
            import torch
            return torch.cuda.is_available()
        except ImportError:
            return False
    
    def _validate_image_format(self, image: np.ndarray) -> bool:
        """Validate image format for segmentation."""
        if not isinstance(image, np.ndarray):
            return False
        
        # Check shape: (C, H, W) where C in [1, 3]
        if len(image.shape) != 3:
            return False
        
        c, h, w = image.shape
        if c not in [1, 3] or h <= 0 or w <= 0:
            return False
        
        return True
    
    def _validate_coco_annotations(self, annotations: dict) -> bool:
        """Validate COCO format annotations."""
        required_keys = ['images', 'annotations', 'categories']
        
        # Check required top-level keys
        if not all(key in annotations for key in required_keys):
            return False
        
        # Check images structure
        if not isinstance(annotations['images'], list) or len(annotations['images']) == 0:
            return False
        
        # Check annotations structure
        if not isinstance(annotations['annotations'], list):
            return False
        
        # Check categories structure
        if not isinstance(annotations['categories'], list) or len(annotations['categories']) == 0:
            return False
        
        return True
    
    def _prepare_training_data(self, images: List[np.ndarray], annotations: dict, temp_dir: str) -> str:
        """Convert COCO format data to .tif files for training."""
        import os
        import json
        import imageio.v3 as imageio
        from scipy import ndimage
        
        # Create subdirectories
        images_dir = os.path.join(temp_dir, "images")
        labels_dir = os.path.join(temp_dir, "labels")
        os.makedirs(images_dir, exist_ok=True)
        os.makedirs(labels_dir, exist_ok=True)
        
        # Create image ID to image mapping
        image_id_to_image = {img['id']: img for img in annotations['images']}
        
        # Create annotation ID to annotation mapping
        ann_id_to_ann = {ann['id']: ann for ann in annotations['annotations']}
        
        # Group annotations by image
        image_annotations = {}
        for ann in annotations['annotations']:
            image_id = ann['image_id']
            if image_id not in image_annotations:
                image_annotations[image_id] = []
            image_annotations[image_id].append(ann)
        
        # Process each image
        for i, image in enumerate(images):
            # Get corresponding image metadata
            if i >= len(annotations['images']):
                break
                
            img_meta = annotations['images'][i]
            image_id = img_meta['id']
            
            # Save image as .tif
            if len(image.shape) == 3 and image.shape[0] in [1, 3]:
                # Convert (C, H, W) to (H, W) or (H, W, C)
                if image.shape[0] == 1:
                    image_2d = image[0]  # (H, W)
                else:
                    image_2d = np.transpose(image, (1, 2, 0))  # (H, W, C)
            else:
                image_2d = image  # Assume already (H, W)
            
            # Normalize to 0-255 if needed
            if image_2d.max() <= 1.0:
                image_2d = (image_2d * 255).astype(np.uint8)
            else:
                image_2d = image_2d.astype(np.uint8)
            
            # Save image
            img_filename = f"train_{i:03d}.tif"
            label_filename = f"train_{i:03d}.tif"
            imageio.imwrite(os.path.join(images_dir, img_filename), image_2d)
            
            # Create segmentation mask
            if image_id in image_annotations:
                h, w = image_2d.shape[:2]
                mask = np.zeros((h, w), dtype=np.uint16)
                
                for ann_idx, ann in enumerate(image_annotations[image_id]):
                    # Convert COCO segmentation to mask
                    if 'segmentation' in ann and ann['segmentation']:
                        # Handle polygon segmentation
                        for seg in ann['segmentation']:
                            if len(seg) >= 6:  # At least 3 points
                                # Convert polygon to mask
                                from PIL import Image, ImageDraw
                                pil_mask = Image.new('L', (w, h), 0)
                                draw = ImageDraw.Draw(pil_mask)
                                
                                # Convert flat list to point pairs
                                points = [(seg[i], seg[i+1]) for i in range(0, len(seg), 2)]
                                draw.polygon(points, fill=ann_idx + 1)
                                
                                # Convert back to numpy
                                seg_mask = np.array(pil_mask)
                                mask[seg_mask > 0] = ann_idx + 1
                
                # Save label
                imageio.imwrite(os.path.join(labels_dir, label_filename), mask)
        
        return temp_dir
    
    def _load_model(self, checkpoint_path=None, is_tiled=False):
        """Lazy load predictor and segmenter for microSAM."""
        # Reload if tiling state changed or model not loaded
        if (self.predictor is not None and self.segmenter is not None and 
            self.is_tiled == is_tiled):
            return self.predictor, self.segmenter
        
        # Import microSAM only when loading the model
        from micro_sam.automatic_segmentation import get_predictor_and_segmenter
        
        # Determine checkpoint to use
        if checkpoint_path is None:
            # Check for fine-tuned checkpoint
            import os
            best_checkpoint = os.path.join(self.checkpoint_dir, "best.pt")
            if os.path.exists(best_checkpoint):
                checkpoint_path = best_checkpoint
                self.current_checkpoint = checkpoint_path
            else:
                checkpoint_path = None  # Use pre-trained
                self.current_checkpoint = None
        
        # Load predictor and segmenter with specified tiling state
        self.predictor, self.segmenter = get_predictor_and_segmenter(
            model_type=self.model_type,
            checkpoint=checkpoint_path,
            device=self.device,
            is_tiled=is_tiled,
        )
        self.is_tiled = is_tiled
        
        return self.predictor, self.segmenter

    def _load_cellpose_model(self):
        """Lazy load Cellpose model (cyto3)."""
        from cellpose import models
        
        if self.cellpose_model is None:
            # Initialize Cellpose model with cyto3 (latest cytoplasm model)
            self.cellpose_model = models.CellposeModel(gpu=True, model_type='cyto3')
            print("Cellpose cyto3 model loaded successfully")
        
        return self.cellpose_model
    
    def _segment_with_cellpose(self, image_2d: np.ndarray) -> np.ndarray:
        """Run Cellpose segmentation on image.
        
        Args:
            image_2d: Image array in (H, W) or (H, W, C) format
            
        Returns:
            Instance segmentation mask with unique IDs per object
        """
        # Ensure Cellpose model is loaded
        self._load_cellpose_model()
        
        # Cellpose expects (H, W) or (H, W, C) format
        # If image is grayscale (H, W), Cellpose will handle it
        # If image is RGB (H, W, 3), Cellpose will handle it
        
        # Run Cellpose segmentation
        # channels=[0, 0] for grayscale (cytoplasm in first channel, no nucleus channel)
        # diameter=None for automatic diameter detection
        masks, flows, styles = self.cellpose_model.eval(
            [image_2d],  # Cellpose expects a list of images
            diameter=None,  # Auto-detect cell diameter
            channels=[0, 0],  # Grayscale: cytoplasm in channel 0, no nucleus
            flow_threshold=0.4,  # Default flow threshold
            cellprob_threshold=0.0,  # Default cell probability threshold
            batch_size=1,  # Explicit batch size for single image
        )
        
        # Return the first mask (we only passed one image)
        return masks[0]

    def _fit_blocking(self, images: List[np.ndarray], annotations: dict, n_epochs: int):
        """Blocking training function to run in a thread."""
        import torch
        import os
        import tempfile
        import shutil
        import micro_sam.training as sam_training
        from torch_em.data import MinInstanceSampler
        
        try:
            # Create temporary directory for training data
            temp_dir = tempfile.mkdtemp(prefix="microsam_training_")
            
            # Prepare training data
            self._prepare_training_data(images, annotations, temp_dir)
            
            # Check for cancellation
            if self.fit_cancelled:
                self.fit_error = "Training cancelled by user"
                return
            
            # Create train/val split (80/20)
            images_dir = os.path.join(temp_dir, "images")
            labels_dir = os.path.join(temp_dir, "labels")
            
            # Get all image files
            import glob
            all_images = sorted(glob.glob(os.path.join(images_dir, "*.tif")))
            all_labels = sorted(glob.glob(os.path.join(labels_dir, "*.tif")))
            
            # Split into train/val
            split_idx = int(0.8 * len(all_images))
            train_images = all_images[:split_idx]
            train_labels = all_labels[:split_idx]
            val_images = all_images[split_idx:]
            val_labels = all_labels[split_idx:]
            
            # Rename files for train/val split
            for i, (img_path, label_path) in enumerate(zip(train_images, train_labels)):
                new_img_path = os.path.join(images_dir, f"train_{i:03d}.tif")
                new_label_path = os.path.join(labels_dir, f"train_{i:03d}.tif")
                os.rename(img_path, new_img_path)
                os.rename(label_path, new_label_path)
            
            for i, (img_path, label_path) in enumerate(zip(val_images, val_labels)):
                new_img_path = os.path.join(images_dir, f"valid_{i:03d}.tif")
                new_label_path = os.path.join(labels_dir, f"valid_{i:03d}.tif")
                os.rename(img_path, new_img_path)
                os.rename(label_path, new_label_path)
            
            # Check for cancellation
            if self.fit_cancelled:
                self.fit_error = "Training cancelled by user"
                return
            
            # Training configuration (hardcoded from training scripts)
            batch_size = 1  # Reduced for memory efficiency
            n_objects_per_batch = 4  # Reduced for memory efficiency
            patch_shape = (512, 512)
            learning_rate = 1e-4
            freeze_encoder = True
            early_stopping = 15
            scheduler_patience = 5
            
            # Use MinInstanceSampler
            sampler = MinInstanceSampler(min_size=20)
            
            # Create dataloaders
            train_loader = sam_training.default_sam_loader(
                raw_paths=images_dir,
                raw_key="train_*.tif",
                label_paths=labels_dir,
                label_key="train_*.tif",
                with_segmentation_decoder=True,
                patch_shape=(1, *patch_shape),
                batch_size=batch_size,
                shuffle=True,
                sampler=sampler,
                num_workers=4,
                pin_memory=True,
            )
            
            val_loader = sam_training.default_sam_loader(
                raw_paths=images_dir,
                raw_key="valid_*.tif",
                label_paths=labels_dir,
                label_key="valid_*.tif",
                with_segmentation_decoder=True,
                patch_shape=(1, *patch_shape),
                batch_size=batch_size,
                shuffle=False,
                sampler=sampler,
                num_workers=4,
                pin_memory=True,
            )
            
            # Check for cancellation
            if self.fit_cancelled:
                self.fit_error = "Training cancelled by user"
                return
            
            # Configure training parameters
            freeze_parts = ["image_encoder"] if freeze_encoder else None
            scheduler_kwargs = {
                "mode": "min",
                "factor": 0.8,
                "patience": scheduler_patience,
                "min_lr": 1e-7,
            }
            
            # Check for existing checkpoint to continue from
            latest_checkpoint = os.path.join(self.checkpoint_dir, "latest.pt")
            resume_from_checkpoint = latest_checkpoint if os.path.exists(latest_checkpoint) else None
            
            # Train the model
            checkpoint_name = "bioengine_shared"
            
            sam_training.train_sam(
                name=checkpoint_name,
                save_root="models",
                model_type=self.model_type,
                train_loader=train_loader,
                val_loader=val_loader,
                n_epochs=n_epochs,
                n_objects_per_batch=n_objects_per_batch,
                with_segmentation_decoder=True,
                freeze=freeze_parts,
                device=self.device,
                lr=learning_rate,
                early_stopping=early_stopping,
                scheduler_kwargs=scheduler_kwargs,
                save_every_kth_epoch=10,
                n_sub_iteration=6,
                mask_prob=0.6,
                checkpoint_path=resume_from_checkpoint,
                overwrite_training=False,
            )
            
            # Update current checkpoint
            best_checkpoint = os.path.join(self.checkpoint_dir, "best.pt")
            self.current_checkpoint = best_checkpoint
            
            self.fit_result = {
                "status": "completed",
                "checkpoint": best_checkpoint,
                "epochs": n_epochs,
                "message": "Training completed successfully"
            }
            
        except Exception as e:
            self.fit_error = f"Training failed: {str(e)}"
        finally:
            # Clean up temporary files
            if 'temp_dir' in locals():
                shutil.rmtree(temp_dir, ignore_errors=True)
    
    async def _fit_background(self, images: List[np.ndarray], annotations: dict, n_epochs: int):
        """Async wrapper that runs blocking training in a thread."""
        import asyncio
        
        # Reset cancellation flag
        self.fit_cancelled = False
        
        # Enforce minimum 2 images requirement
        if len(images) < 2:
            raise ValueError(
                f"Minimum 2 images required for proper train/validation split. "
                f"Received {len(images)} image(s)."
            )
        
        # Run blocking training in a thread pool to avoid blocking the event loop
        # This allows health checks to continue responding
        try:
            await asyncio.to_thread(self._fit_blocking, images, annotations, n_epochs)
        except Exception as e:
            self.fit_error = f"Training failed: {str(e)}"

    @schema_method
    async def start_fit(
        self,
        images: List[Any] = Field(
            ...,
            description="List of training images as numpy arrays",
        ),
        annotations: Dict[str, Any] = Field(
            ...,
            description="COCO format annotations dictionary",
        ),
        n_epochs: int = Field(
            50,
            description="Number of epochs to train",
        ),
    ) -> Dict[str, str]:
        import asyncio
        
        # Validate inputs
        if not self._validate_coco_annotations(annotations):
            return {"status": "error", "message": "Invalid COCO annotations format"}
        
        for i, image in enumerate(images):
            if not self._validate_image_format(image):
                return {"status": "error", "message": f"Invalid image format at index {i}. Expected (C, H, W) where C in [1, 3]"}
        
        # Start training task
        self.fit_task = asyncio.create_task(self._fit_background(images, annotations, n_epochs))
        self.fit_result = None
        self.fit_error = None

        return {"status": "started", "message": "Fit task started in background"}

    @schema_method
    async def get_fit_status(
        self,
    ) -> Dict[str, str]:
        if self.fit_task is None:
            return {
                "status": "not_started",
                "message": "Fit task has not been started.",
            }
        elif self.fit_task.done():
            if self.fit_error is not None:
                return {"status": "error", "message": str(self.fit_error)}
            else:
                return {
                    "status": "completed",
                    "message": "Fit task completed successfully.",
                }
        else:
            return {"status": "running", "message": "Fit task is still running."}

    @schema_method
    async def cancel_fit(
        self,
    ) -> Dict[str, str]:
        if self.fit_task is None:
            return {
                "status": "not_started",
                "message": "Fit task has not been started.",
            }
        elif self.fit_task.done():
            return {"status": "completed", "message": "Fit task has already completed."}

        # Set cancellation flag - this is a cooperative cancellation signal
        self.fit_cancelled = True

        # Cancel the asyncio task
        self.fit_task.cancel()

        # Wait for the task to actually finish (with timeout)
        try:
            await asyncio.wait_for(self.fit_task, timeout=5.0)
        except asyncio.TimeoutError:
            # Task didn't finish in time, but flag is set so it will check when it completes
            pass
        except asyncio.CancelledError:
            # Expected when task is cancelled
            pass

        self.fit_task = None
        self.fit_result = None
        self.fit_error = "Task was cancelled by user"

        return {"status": "cancelled", "message": "Fit task has been cancelled."}

    @schema_method
    async def encode_image(
        self,
        image: Any = Field(
            ...,
            description="Input data as numpy array of shape (C, H, W)",
        ),
    ) -> Any:
        # Validate input format
        if not self._validate_image_format(image):
            raise ValueError(f"Invalid image format. Expected (C, H, W) where C in [1, 3], got {image.shape}")
        
        # Load model if not already loaded (use non-tiled for encoding)
        if self.predictor is None:
            self._load_model(is_tiled=False)
        
        # Convert image to the format expected by SAM
        if len(image.shape) == 3 and image.shape[0] in [1, 3]:
            # Convert (C, H, W) to (H, W) for grayscale or (H, W, C) for RGB
            if image.shape[0] == 1:
                image_2d = image[0]  # (H, W)
            else:
                image_2d = np.transpose(image, (1, 2, 0))  # (H, W, C)
        else:
            image_2d = image  # Assume already (H, W)
        
        # Set image in predictor to compute embeddings
        self.predictor.set_image(image_2d)
        
        # Extract embeddings from predictor's internal state
        # The predictor stores the image features internally
        # We need to access the features that were computed
        if hasattr(self.predictor, 'features') and self.predictor.features is not None:
            # Extract the image features (embeddings)
            features = self.predictor.features
            if hasattr(features, 'cpu'):
                features = features.cpu().numpy()
            
            # Flatten to 1D array
            embedding = features.flatten()
            return embedding
        else:
            raise RuntimeError("Failed to extract embeddings from predictor")

    @schema_method
    async def download_mask_decoder(
        self,
    ) -> bytes:
        import torch
        import io
        
        # Load model if not already loaded
        if self.predictor is None or self.segmenter is None:
            self._load_model()
        
        # Get the current checkpoint path
        checkpoint_path = self.current_checkpoint
        if checkpoint_path is None:
            # Use pre-trained model
            from micro_sam.util import get_sam_model
            model = get_sam_model(model_type=self.model_type, device=self.device)
        else:
            # Load fine-tuned model
            checkpoint = torch.load(checkpoint_path, map_location=self.device)
            from micro_sam.util import get_sam_model
            model = get_sam_model(model_type=self.model_type, device=self.device)
            model.load_state_dict(checkpoint["model_state"])
        
        # Extract mask decoder state dict
        mask_decoder_state = {}
        for name, param in model.mask_decoder.named_parameters():
            mask_decoder_state[name] = param.cpu()
        
        for name, buffer in model.mask_decoder.named_buffers():
            mask_decoder_state[name] = buffer.cpu()
        
        # Serialize to bytes
        buffer = io.BytesIO()
        torch.save(mask_decoder_state, buffer)
        buffer.seek(0)
        
        return buffer.getvalue()

    def _decode_image(self, image_base64: str) -> np.ndarray:
        """Decode base64-encoded PNG image to numpy array."""
        import base64
        import io
        from PIL import Image
        
        try:
            # Decode base64 to get image bytes
            image_bytes = base64.b64decode(image_base64)
            
            # Decode bytes to PIL Image
            pil_image = Image.open(io.BytesIO(image_bytes))
            
            # Convert to numpy array in one step with target dtype
            image_array = np.array(pil_image, dtype=np.uint8)
            
            # Handle format conversion efficiently
            if len(image_array.shape) == 2:
                # Grayscale: (H, W) -> (1, H, W) - use newaxis (faster than expand_dims)
                image_array = image_array[np.newaxis, :, :]
            elif len(image_array.shape) == 3:
                # RGB: (H, W, C) -> (C, H, W) - transpose is already efficient
                image_array = np.transpose(image_array, (2, 0, 1))
            
            return image_array
            
        except Exception as e:
            raise ValueError(f"Failed to decode PNG image: {str(e)}")
    
    def _encode_segmentation_to_png(self, segmentation: np.ndarray) -> str:
        """Encode segmentation mask to base64-encoded PNG string."""
        import base64
        import io
        from PIL import Image
        
        try:
            # Normalize segmentation to 0-255 uint8
            if segmentation.dtype != np.uint8:
                # Normalize to 0-255 range
                if segmentation.max() > segmentation.min():
                    seg_normalized = ((segmentation - segmentation.min()) / 
                                    (segmentation.max() - segmentation.min()) * 255).astype(np.uint8)
                else:
                    seg_normalized = np.zeros_like(segmentation, dtype=np.uint8)
            else:
                seg_normalized = segmentation
            
            # Handle different segmentation formats
            if len(seg_normalized.shape) == 2:
                # Grayscale mask: (H, W)
                pil_image = Image.fromarray(seg_normalized, mode='L')
            elif len(seg_normalized.shape) == 3:
                # If (C, H, W), convert to (H, W) for grayscale
                if seg_normalized.shape[0] == 1:
                    pil_image = Image.fromarray(seg_normalized[0], mode='L')
                else:
                    # RGB: (H, W, C)
                    pil_image = Image.fromarray(seg_normalized, mode='RGB')
            else:
                raise ValueError(f"Unsupported segmentation shape: {seg_normalized.shape}")
            
            # Encode to PNG (lossless format)
            png_buffer = io.BytesIO()
            pil_image.save(png_buffer, format='PNG')
            png_bytes = png_buffer.getvalue()
            
            # Encode to base64
            png_base64 = base64.b64encode(png_bytes).decode('utf-8')
            
            return png_base64
            
        except Exception as e:
            raise ValueError(f"Failed to encode segmentation to PNG: {str(e)}")
    
    @schema_method
    async def segment_all(
        self,
        image_or_embedding: Any = Field(
            ...,
            description="Base64-encoded PNG string (required for images). Numpy arrays are NOT accepted for images.",
        ),
        embedding: bool = Field(
            False,
            description="If True, the input is treated as an embedding; otherwise, as a PNG image.",
        ),
        method: str = Field(
            "cellpose",
            description="Segmentation method: 'microsam' or 'cellpose'. Default is 'cellpose'.",
        ),
        tiling: bool = Field(
            False,
            description="Whether to use tiling for large images. Default is False. Only applicable for microSAM.",
        ),
        tile_shape: Any = Field(
            None,
            description="Shape of tiles for tiled prediction (tuple of (height, width)). Default is (512, 512) when tiling is enabled. Only applicable for microSAM.",
        ),
        halo: Any = Field(
            None,
            description="Overlap of tiles for tiled prediction (tuple of (height, width)). Default is (128, 128) when tiling is enabled. Only applicable for microSAM.",
        ),
        min_cell_size: int = Field(
            100,
            description="Minimum cell size in pixels (area) to filter out small objects. Passed as 'min_size' to the segmenter's generate method. Default is 100.",
        ),
    ) -> Any:
        # Import skimage for polygon extraction (used by both methods)
        from skimage.measure import find_contours, regionprops, approximate_polygon
        
        # Validate method parameter
        if method not in ["microsam", "cellpose"]:
            raise ValueError(f"Invalid method: {method}. Must be 'microsam' or 'cellpose'")
        
        # Input validation and decoding
        if embedding:
            # For embeddings, expect 1D array
            if not isinstance(image_or_embedding, np.ndarray):
                image_or_embedding = np.array(image_or_embedding)
            if len(image_or_embedding.shape) != 1:
                raise ValueError(f"Expected 1D embedding array, got shape {image_or_embedding.shape}")
        else:
            # STRICT: For images, ONLY accept base64-encoded PNG string
            # NO numpy arrays, NO fallback, NO exceptions
            if not isinstance(image_or_embedding, str):
                raise ValueError(
                    f"ONLY base64-encoded PNG strings are accepted for images. "
                    f"Received {type(image_or_embedding).__name__}. "
                    f"Numpy arrays and other formats are NOT supported. "
                    f"Please encode your image as PNG and encode as base64 string."
                )
            
            # Additional check: ensure it's not an empty string
            if len(image_or_embedding.strip()) == 0:
                raise ValueError("Empty string provided. Must be a valid base64-encoded PNG string.")
            
            # Decode PNG image from base64
            image_array = self._decode_image(image_or_embedding)
            
            # Validate decoded image format
            if not self._validate_image_format(image_array):
                raise ValueError(f"Invalid decoded image format. Expected (C, H, W) where C in [1, 3], got {image_array.shape}")
        
        # Set default tile_shape and halo if tiling is enabled (only for microSAM)
        if tiling and method == "microsam":
            if tile_shape is None:
                tile_shape = (512, 512)
            else:
                # Convert to tuple if it's a list
                if isinstance(tile_shape, list):
                    tile_shape = tuple(tile_shape)
                if not isinstance(tile_shape, tuple) or len(tile_shape) != 2:
                    raise ValueError(f"tile_shape must be a tuple of (height, width), got {tile_shape}")
            
            if halo is None:
                halo = (128, 128)
            else:
                # Convert to tuple if it's a list
                if isinstance(halo, list):
                    halo = tuple(halo)
                if not isinstance(halo, tuple) or len(halo) != 2:
                    raise ValueError(f"halo must be a tuple of (height, width), got {halo}")
        else:
            tile_shape = None
            halo = None
        
        # Run segmentation based on selected method
        if embedding:
            # For embeddings, we need to handle this differently
            # This is a simplified approach - in practice, you might need to reconstruct the image
            # or use the embedding directly with the segmenter
            raise NotImplementedError("Embedding-based segmentation not yet implemented")
        else:
            # Convert image to the format expected by segmentation models
            if len(image_array.shape) == 3 and image_array.shape[0] in [1, 3]:
                # Convert (C, H, W) to (H, W) for grayscale or (H, W, C) for RGB
                if image_array.shape[0] == 1:
                    image_2d = image_array[0]  # (H, W)
                else:
                    image_2d = np.transpose(image_array, (1, 2, 0))  # (H, W, C)
            else:
                image_2d = image_array  # Assume already (H, W)
            
            # Ensure image is uint8
            if image_2d.dtype != np.uint8:
                if image_2d.max() <= 1.0:
                    image_2d = (image_2d * 255).astype(np.uint8)
                else:
                    image_2d = image_2d.astype(np.uint8)
            
            # Normalization is handled on client side - using original image
            # # Apply contrast stretching normalization (2nd-98th percentile)
            
            # Run segmentation with selected method using original image
            if method == "cellpose":
                # Load Cellpose model and run segmentation
                instances = self._segment_with_cellpose(image_2d)
            elif method == "microsam":
                # Import microSAM only when needed
                from micro_sam.automatic_segmentation import automatic_instance_segmentation
                
                # Load microSAM model with appropriate tiling state
                self._load_model(is_tiled=tiling)
                
                # Prepare kwargs for microSAM segmentation
                kwargs = {
                    "predictor": self.predictor,
                    "segmenter": self.segmenter,
                    "input_path": image_2d,
                    "ndim": 2,
                    "verbose": False,  # Disable console output for speed
                    "min_size": min_cell_size,  # Pass min_size to segmenter.generate() via generate_kwargs
                }
                
                # Add tiling parameters if tiling is enabled
                if tiling:
                    kwargs["tile_shape"] = tile_shape
                    kwargs["halo"] = halo
                
                # Run segmentation - returns instance segmentation with unique IDs per object
                instances = automatic_instance_segmentation(**kwargs)
            
            # Convert prediction to numpy array if it's not already
            if not isinstance(instances, np.ndarray):
                # If prediction is a dict or other format, extract the mask
                if isinstance(instances, dict):
                    # Try common keys for segmentation masks
                    for key in ['segmentation', 'mask', 'masks', 'result']:
                        if key in instances:
                            instances = instances[key]
                            break
                    else:
                        raise ValueError(f"Could not find segmentation mask in prediction dict. Keys: {list(instances.keys())}")
                else:
                    instances = np.array(instances)
            
            # Extract polygons for each instance object using regionprops
            # This directly processes the instance mask where each object has a unique ID
            props = regionprops(instances)
            
            # Create list to store polygons for each object
            polygons_list = []
            
            # Extract polygon contours for each instance object
            for prop in props:
                instance_id = prop.label
                
                # Get the mask for this specific instance only
                instance_mask = (instances == instance_id).astype(np.uint8)
                

                # Find contours for this instance with high connectivity for detailed boundaries
                # fully_connected='high' ensures we capture all boundary pixels
                contours = find_contours(instance_mask, level=0.5, fully_connected='high')
                
                # Convert contours to polygon format with minimal simplification
                # Each contour is a list of (row, col) coordinates
                instance_polygons = []
                for contour in contours:
                    # Use very low tolerance (0.3 pixels) to preserve fine details
                    # This removes only truly redundant points while keeping shape accuracy
                    simplified_contour = approximate_polygon(contour, tolerance=0.3)
                    
                    # Ensure we have enough points for a valid polygon
                    if len(simplified_contour) < 3:
                        # If simplification removed too many points, use original contour
                        simplified_contour = contour
                    
                    # Convert from (row, col) to (x, y) format
                    # contour shape: (N, 2) where each row is (row, col)
                    # Convert to (x, y) by swapping: (col, row) -> (x, y)
                    polygon = [[float(point[1]), float(point[0])] for point in simplified_contour]
                    instance_polygons.append(polygon)
                
                # Get bounding box from regionprops
                bbox = prop.bbox  # (min_row, min_col, max_row, max_col)
                
                # Store polygon data for this instance
                polygons_list.append({
                    "id": int(instance_id),
                    "polygons": instance_polygons,  # List of polygons (outer contour + holes if any)
                    "bbox": [int(bbox[1]), int(bbox[0]), int(bbox[3]), int(bbox[2])]  # [x_min, y_min, x_max, y_max]
                })
            
            # Return both mask and polygons
            # Mask is returned as numpy array to preserve exact uint32 instance IDs (critical for medical/industrial use)
            return {
                "polygons": polygons_list,
                "mask": instances  # Numpy array with exact instance segmentation mask (preserves uint32 dtype and all instance IDs)
            }

if __name__ == "__main__":
    import asyncio

    cell_segmenter = CellSegmenter.func_or_class()

    async def test():
        response = await cell_segmenter.start_fit()
        print(response)

    asyncio.run(test())

