"""
Basic tests to verify testing infrastructure.
"""

import pytest
import numpy as np
from PIL import Image
import io
import base64


class TestBasicFunctionality:
    """Basic tests that don't require complex dependencies."""
    
    @pytest.mark.unit
    def test_numpy_operations(self):
        """Test basic numpy operations."""
        arr = np.array([1, 2, 3, 4, 5])
        assert arr.sum() == 15
        assert arr.mean() == 3.0
        assert arr.shape == (5,)
    
    @pytest.mark.unit
    def test_image_creation(self):
        """Test basic image creation and manipulation."""
        # Create a simple image
        image_array = np.zeros((100, 100, 3), dtype=np.uint8)
        image_array[25:75, 25:75] = [255, 0, 0]  # Red square
        
        image = Image.fromarray(image_array)
        assert image.size == (100, 100)
        assert image.mode == 'RGB'
        
        # Test base64 encoding
        buffered = io.BytesIO()
        image.save(buffered, format="PNG")
        image_b64 = base64.b64encode(buffered.getvalue()).decode("utf-8")
        
        # Verify we can decode it back
        decoded_data = base64.b64decode(image_b64)
        decoded_image = Image.open(io.BytesIO(decoded_data))
        assert decoded_image.size == (100, 100)
    
    @pytest.mark.unit
    def test_microscopy_metadata_structure(self):
        """Test microscopy metadata structure."""
        metadata = {
            "acquisition": {
                "timestamp": "2024-01-01T12:00:00Z",
                "objective": "20x",
                "pixel_size_um": 0.325,
                "exposure_times": {
                    "BF": 50,
                    "F488": 100,
                    "F561": 150
                }
            },
            "sample": {
                "name": "test_sample",
                "well": "A1",
                "position": {"x": 1000, "y": 2000, "z": 150}
            }
        }
        
        # Verify structure
        assert "acquisition" in metadata
        assert "sample" in metadata
        assert metadata["acquisition"]["pixel_size_um"] == 0.325
        assert metadata["sample"]["well"] == "A1"
        assert len(metadata["acquisition"]["exposure_times"]) == 3
    
    @pytest.mark.unit
    def test_tile_coordinate_calculation(self):
        """Test tile coordinate calculations."""
        def calculate_tile_coordinates(x, y, tile_size):
            """Calculate tile row and column from pixel coordinates."""
            row = y // tile_size
            col = x // tile_size
            return row, col
        
        # Test basic coordinates
        row, col = calculate_tile_coordinates(0, 0, 256)
        assert row == 0 and col == 0
        
        row, col = calculate_tile_coordinates(256, 256, 256)
        assert row == 1 and col == 1
        
        row, col = calculate_tile_coordinates(100, 200, 256)
        assert row == 0 and col == 0
    
    @pytest.mark.unit
    def test_image_processing_functions(self):
        """Test basic image processing functions."""
        def adjust_contrast_brightness(image_array, contrast=1.0, brightness=0.0):
            """Adjust image contrast and brightness."""
            adjusted = image_array.astype(np.float32)
            adjusted = adjusted * contrast + brightness * 255
            adjusted = np.clip(adjusted, 0, 255)
            return adjusted.astype(np.uint8)
        
        # Create test image
        image = np.full((50, 50, 3), 128, dtype=np.uint8)  # Gray image
        
        # Test contrast adjustment
        high_contrast = adjust_contrast_brightness(image, contrast=2.0)
        assert high_contrast[0, 0, 0] == 255  # Should be clipped to max
        
        # Test brightness adjustment
        brighter = adjust_contrast_brightness(image, brightness=0.2)
        assert brighter[0, 0, 0] > 128  # Should be brighter
    
    @pytest.mark.unit
    async def test_async_functionality(self):
        """Test async functionality."""
        async def mock_async_operation(delay=0.01):
            """Mock async operation."""
            import asyncio
            await asyncio.sleep(delay)
            return {"status": "success", "data": "test_data"}
        
        result = await mock_async_operation()
        assert result["status"] == "success"
        assert result["data"] == "test_data"
    
    @pytest.mark.unit
    def test_error_handling(self):
        """Test error handling patterns."""
        def safe_divide(a, b):
            """Safe division with error handling."""
            try:
                return {"result": a / b, "error": None}
            except ZeroDivisionError:
                return {"result": None, "error": "Division by zero"}
            except Exception as e:
                return {"result": None, "error": str(e)}
        
        # Test normal operation
        result = safe_divide(10, 2)
        assert result["result"] == 5.0
        assert result["error"] is None
        
        # Test error case
        result = safe_divide(10, 0)
        assert result["result"] is None
        assert result["error"] == "Division by zero"


class TestFixtures:
    """Test that our fixtures work correctly."""
    
    @pytest.mark.unit
    def test_temp_dir_fixture(self, temp_dir):
        """Test temporary directory fixture."""
        assert temp_dir.exists()
        assert temp_dir.is_dir()
        
        # Create a test file
        test_file = temp_dir / "test.txt"
        test_file.write_text("test content")
        assert test_file.exists()
    
    @pytest.mark.unit
    def test_sample_image_fixture(self, sample_image):
        """Test sample image fixture."""
        assert isinstance(sample_image, Image.Image)
        assert sample_image.size == (512, 512)
        assert sample_image.mode == 'RGB'
    
    @pytest.mark.unit
    def test_sample_image_base64_fixture(self, sample_image_base64):
        """Test sample image base64 fixture."""
        assert isinstance(sample_image_base64, str)
        
        # Verify it's valid base64
        decoded_data = base64.b64decode(sample_image_base64)
        image = Image.open(io.BytesIO(decoded_data))
        assert image.size == (512, 512)
    
    @pytest.mark.unit
    def test_microscopy_metadata_fixture(self, microscopy_metadata):
        """Test microscopy metadata fixture."""
        assert "acquisition" in microscopy_metadata
        assert "sample" in microscopy_metadata
        assert "imaging" in microscopy_metadata
        
        # Check specific values
        assert microscopy_metadata["acquisition"]["pixel_size_um"] == 0.325
        assert microscopy_metadata["sample"]["well"] == "A1"
        assert "BF" in microscopy_metadata["imaging"]["channels"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"]) 