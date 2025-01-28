import io
import os
import base64
from logging import getLogger
from typing import Union
from PIL import Image
import numpy as np
import requests
import dotenv
import torch
from dotenv import find_dotenv, load_dotenv
from kaibu_utils import mask_to_features
from segment_anything import SamPredictor, sam_model_registry, SamAutomaticMaskGenerator

dotenv.load_dotenv()


#Acknowledgement: This script is adapted from the original script provided by the authors: @Nils Mechetel, https://github.com/bioimage-io/bioimageio-colab/blob/main/bioimageio_colab/register_sam_service.py.

# This Python script registers a SAM (Segment Anything Model) annotation service on the BioImageIO Colab workspace, 
# enabling interactive image segmentation functionalities through a series of image-processing and mask-generation utilities. 
# Users can load models, compute embeddings, perform segmentation with initial or existing embeddings, and segment all cells in an image.

ENV_FILE = find_dotenv()
if ENV_FILE:
    load_dotenv(ENV_FILE)

MODELS = {
    "vit_b": "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth",
    "vit_b_lm": "https://uk1s3.embassy.ebi.ac.uk/public-datasets/bioimage.io/diplomatic-bug/1/files/vit_b.pt",
    "vit_l_lm": "https://zenodo.org/records/11111177/files/vit_l.pt",
    "vit_b_em_organelles": "https://uk1s3.embassy.ebi.ac.uk/public-datasets/bioimage.io/noisy-ox/1/files/vit_b.pt",
}
STORAGE = {"vit_b": "models/sam_vit_b_01ec64.pth", "vit_b_lm": "models/vit_b_lm.pt", "vit_l_lm": "models/vit_l_lm.pt"}
CURRENT_MODEL = {"name": None, "model": None}

logger = getLogger(__name__)
logger.setLevel("INFO")

def _load_model(model_name: str) -> torch.nn.Module:
  global CURRENT_MODEL
  
  if CURRENT_MODEL["name"] == model_name and CURRENT_MODEL["model"] is not None:
      logger.info(f"Model {model_name} is already loaded, reusing it.")
      return CURRENT_MODEL["model"]

  if model_name not in MODELS:
      raise ValueError(
          f"Model {model_name} not found. Available models: {list(MODELS.keys())}"
      )

  # Check if the model is available in local storage
  if model_name in STORAGE:
      local_path = STORAGE[model_name]
      if os.path.exists(local_path):
          logger.info(f"Loading model {model_name} from local storage at {local_path}...")
          device = "cuda" if torch.cuda.is_available() else "cpu"
          print(device)
          ckpt = torch.load(local_path, map_location=device)
          model_type = model_name[:5]
          sam = sam_model_registry[model_type]()
          sam.load_state_dict(ckpt)
          sam.to(device)
          CURRENT_MODEL["name"] = model_name
          CURRENT_MODEL["model"] = sam
          return sam
      else:
          logger.warning(f"Model file {local_path} not found in local storage.")

  # If not in local storage, download the model
  model_url = MODELS[model_name]
  logger.info(f"Loading model {model_name} from {model_url}...")
  response = requests.get(model_url)
  if response.status_code != 200:
      raise RuntimeError(f"Failed to download model from {model_url}")
  buffer = io.BytesIO(response.content)

  # Load model state
  device = "cuda" if torch.cuda.is_available() else "cpu"
  ckpt = torch.load(buffer, map_location=device)
  model_type = model_name[:5]
  sam = sam_model_registry[model_type]()
  sam.load_state_dict(ckpt)
  sam.to(device)
  

  # Optionally, save the downloaded model to local storage for future use
  os.makedirs(os.path.dirname(STORAGE[model_name]), exist_ok=True)
  with open(STORAGE[model_name], 'wb') as f:
      f.write(buffer.getvalue())
  logger.info(f"Model {model_name} cached to {STORAGE[model_name]}")

  CURRENT_MODEL["name"] = model_name
  CURRENT_MODEL["model"] = sam
  return sam

def _to_image(input_: np.ndarray) -> np.ndarray:
    # we require the input to be uint8
    if input_.dtype != np.dtype("uint8"):
        # first normalize the input to [0, 1]
        input_ = input_.astype("float32") - input_.min()
        input_ = input_ / input_.max()
        # then bring to [0, 255] and cast to uint8
        input_ = (input_ * 255).astype("uint8")
    if input_.ndim == 2:
        image = np.concatenate([input_[..., None]] * 3, axis=-1)
    elif input_.ndim == 3 and input_.shape[-1] == 3:
        image = input_
    else:
        raise ValueError(
            f"Invalid input image of shape {input_.shape}. Expect either 2D grayscale or 3D RGB image."
        )
    return image

def compute_embedding_with_initial_segment(model_name: str, image_bytes: bytes, point_coordinates: Union[list, np.ndarray], point_labels: Union[list, np.ndarray]) -> dict:
    # Convert bytes to a numpy array
    image = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
    logger.info(f"Image size: {image.shape}, Point coordinates received: {point_coordinates}")

    # Load model
    sam = _load_model(model_name)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    logger.info(f"Computing embedding of model {model_name} with initial segmentation...")
    predictor = SamPredictor(sam)
    predictor.set_image(_to_image(image))

    # Perform initial segmentation
    if isinstance(point_coordinates, list):
        point_coordinates = np.array(point_coordinates, dtype=np.float32)
    if isinstance(point_labels, list):
        point_labels = np.array(point_labels, dtype=np.float32)

    # Move point coordinates and labels to the GPU
    point_coordinates_tensor = torch.tensor(point_coordinates).to(device)
    point_labels_tensor = torch.tensor(point_labels).to(device)

    # Convert tensors back to numpy arrays for the predictor
    point_coordinates = point_coordinates_tensor.cpu().numpy()
    point_labels = point_labels_tensor.cpu().numpy()

    mask, scores, logits = predictor.predict(
    point_coords=point_coordinates,
    point_labels=point_labels,
    multimask_output=False,
    )

    # Ensure the mask is not empty
    if mask is None or mask.size == 0:
        logger.error("Generated mask is empty.")
        return {"error": "Generated mask is empty."}

    # Convert mask to an image
    mask_image = Image.fromarray((mask[0] * 255).astype(np.uint8))
    buffer = io.BytesIO()
    mask_image.save(buffer, format="PNG")
    mask_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
    logger.info(f"Computed embedding of model {model_name} with initial segmentation. Mask size: {mask_image.size}")
    # Store the embedding in STORAGE
    STORAGE['current_embedding'] = {
        'model_name': model_name,
        'embedding': (mask, scores, logits)  # Store the necessary data
    }
    return {"mask": mask_base64}




def reset_embedding() -> bool:
    if 'current_embedding' not in STORAGE:
        logger.info("No embedding found in storage.")
        return False
    else:
        logger.info("Resetting embedding...")
        del STORAGE['current_embedding']
        return True

def segment(
    point_coordinates: Union[list, np.ndarray],
    point_labels: Union[list, np.ndarray],
) -> list:
    if 'current_embedding' not in STORAGE:
        logger.info("No embedding found in storage.")
        return []

    logger.info(f"Segmenting with model {STORAGE['current_embedding'].get('model_name')}...")
    # Load the model with the pre-computed embedding
    sam = _load_model(STORAGE['current_embedding'].get('model_name'))
    predictor = SamPredictor(sam)
    for key, value in STORAGE['current_embedding'].items():
        if key != "model_name":
            setattr(predictor, key, value)
    # Run the segmentation
    logger.debug(f"Point coordinates: {point_coordinates}, {point_labels}")
    if isinstance(point_coordinates, list):
        point_coordinates = np.array(point_coordinates, dtype=np.float32)
    if isinstance(point_labels, list):
        point_labels = np.array(point_labels, dtype=np.float32)

    # Move point coordinates and labels to the GPU
    device = "cuda" if torch.cuda.is_available() else "cpu"
    point_coordinates_tensor = torch.tensor(point_coordinates).to(device)
    point_labels_tensor = torch.tensor(point_labels).to(device)

    # Convert tensors back to numpy arrays for the predictor
    point_coordinates = point_coordinates_tensor.cpu().numpy()
    point_labels = point_labels_tensor.cpu().numpy()

    mask, scores, logits = predictor.predict(
    point_coords=point_coordinates,
    point_labels=point_labels,
    multimask_output=False,
    )
    
    logger.debug(f"Predicted mask of shape {mask.shape}")
    features = mask_to_features(mask[0])
    return features

def segment_with_existing_embedding(image_bytes: bytes, point_coordinates: Union[list, np.ndarray], point_labels: Union[list, np.ndarray]) -> dict:
    if 'current_embedding' not in STORAGE:
        logger.info("No embedding found in storage.")
        return {"error": "No embedding found in storage."}

    # Retrieve the stored embedding
    embedding_data = STORAGE['current_embedding']
    model_name = embedding_data['model_name']

    # Convert bytes to a numpy array
    image = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
    logger.info(f"Image size: {image.shape}, Point coordinates received: {point_coordinates}")

    logger.info(f"Segmenting with existing embedding from model {model_name}...")
    sam = _load_model(model_name)
    predictor = SamPredictor(sam)

    # Set the image on the predictor
    predictor.set_image(_to_image(image))

    # Set any additional attributes from the stored embedding
    for key, value in embedding_data.items():
        if key not in ["model_name", "is_image_set"]:
            setattr(predictor, key, value)

    if isinstance(point_coordinates, list):
        point_coordinates = np.array(point_coordinates, dtype=np.float32)
    if isinstance(point_labels, list):
        point_labels = np.array(point_labels, dtype=np.float32)

    # Move point coordinates and labels to the GPU
    device = "cuda" if torch.cuda.is_available() else "cpu"
    point_coordinates_tensor = torch.tensor(point_coordinates).to(device)
    point_labels_tensor = torch.tensor(point_labels).to(device)

    # Convert tensors back to numpy arrays for the predictor
    point_coordinates = point_coordinates_tensor.cpu().numpy()
    point_labels = point_labels_tensor.cpu().numpy()

    mask, scores, logits = predictor.predict(
    point_coords=point_coordinates,
    point_labels=point_labels,
    multimask_output=False,
    )

    # Convert mask to an image
    mask_image = Image.fromarray((mask[0] * 255).astype(np.uint8))
    buffer = io.BytesIO()
    mask_image.save(buffer, format="PNG")
    mask_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")

    return {"mask": mask_base64}

def segment_all_cells(model_name: str, image_bytes: bytes) -> dict:
    # Convert bytes to a numpy array
    image = np.array(Image.open(io.BytesIO(image_bytes)).convert("RGB"))
    logger.info(f"Image size: {image.shape}")

    # Load model
    sam = _load_model(model_name)

    # Move the model to the GPU
    device = "cuda" if torch.cuda.is_available() else "cpu"
    sam.to(device)

    # Create an automatic mask generator
    mask_generator = SamAutomaticMaskGenerator(sam)

    # Generate the masks
    masks = mask_generator.generate(image)

    # Check if any masks were generated
    if not masks:
        logger.error("No masks generated.")
        return {"error": "No masks generated."}

    # Process the masks
    bounding_boxes = []
    mask_data = []
    for mask in masks:
        bbox = mask['bbox']  # x, y, width, height
        bounding_boxes.append(bbox)

        mask_array = mask['segmentation']  # 2D numpy array of bools

        # Convert mask to base64
        mask_image = Image.fromarray((mask_array * 255).astype(np.uint8))
        buffer = io.BytesIO()
        mask_image.save(buffer, format="PNG")
        mask_base64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
        mask_data.append(mask_base64)

    logger.info(f"Segmented {len(bounding_boxes)} cells.")
    return {"bounding_boxes": bounding_boxes, "masks": mask_data}

async def setup_service(server) -> None:
    """
    Register the SAM annotation service on the BioImageIO Colab workspace.
    """
    await server.register_service({
        "name": "Interactive Segmentation",
        "id": "interactive-segmentation",
        "config": {
            "visibility": "public",
            "require_context": False,
            "run_in_executor": True,
        },
        "type": "echo",
        "compute_embedding_with_initial_segment": compute_embedding_with_initial_segment,
        "segment": segment,
        "segment_with_existing_embedding": segment_with_existing_embedding,
        "reset_embedding": reset_embedding,
        "segment_all_cells": segment_all_cells,
    })
    
    print("SAM service registered successfully.")