# Testing Guide for Agent-Lens

## Overview

Agent-Lens uses a comprehensive testing infrastructure to ensure reliability of the smart microscopy platform. Our multi-layered approach includes unit tests, integration tests, and hardware simulation.

## ✅ Current Status

- **Testing Infrastructure**: ✅ Complete and working
- **Dependencies**: ✅ All testing tools configured (pytest, React Testing Library, etc.)
- **Test Runner**: ✅ Fully functional with multiple test types
- **Basic Tests**: ✅ 11 tests passing, covering core functionality
- **Similarity Service Tests**: ✅ Working with vector embeddings and CLIP
- **Documentation**: ✅ Comprehensive guides and examples

## Quick Start

### Install Dependencies

```bash
# Backend testing dependencies
pip install -r requirements_test.txt
pip install faiss-cpu torch git+https://github.com/openai/CLIP.git

# Frontend testing dependencies (optional)
cd frontend && npm install && cd ..
```

### Run Tests

```bash
# Fast development testing (recommended)
python scripts/run_tests.py --type fast

# Run with coverage
python scripts/run_tests.py --coverage

# Run only unit tests
python scripts/run_tests.py --type unit

# Run slow tests (includes vector similarity)
python scripts/run_tests.py --type slow
```

## Test Categories

### **Unit Tests** (`@pytest.mark.unit`)
Fast, isolated tests with mocked dependencies:
```python
@pytest.mark.unit
def test_image_processing(sample_image):
    """Test image processing functions."""
    processed = apply_contrast_enhancement(sample_image)
    assert processed.size == sample_image.size
```

### **Integration Tests** (`@pytest.mark.integration`)
Tests with real service interactions:
```python
@pytest.mark.integration
async def test_microscope_service_integration(mock_hypha_server):
    """Test complete workflow with service communication."""
    result = await move_stage_and_capture(x=100, y=200)
    assert result["status"] == "success"
```

### **Slow Tests** (`@pytest.mark.slow`)
Long-running tests with AI models and large datasets:
```python
@pytest.mark.slow
async def test_similarity_search_with_clip():
    """Test vector similarity search with real CLIP model."""
    # Uses real FAISS index and CLIP embeddings
    results = await find_similar_cells(query_image, top_k=5)
    assert len(results) <= 5
```

## Test Structure

```
agent_lens/tests/
├── conftest.py                    # Shared fixtures and configuration
├── test_basic.py                  # ✅ Core functionality (11 tests passing)
├── test_similarity_service.py    # ✅ Vector similarity with CLIP/FAISS
└── __pycache__/                   # Pytest cache

frontend/components/__tests__/     # React component tests
├── Notification.test.jsx
├── ControlButton.test.jsx
└── ...
```

## Key Test Fixtures

```python
# Essential fixtures (from conftest.py)
@pytest.fixture
def temp_dir():
    """Temporary directory for test files."""

@pytest.fixture
def sample_image():
    """Realistic microscopy image data."""

@pytest.fixture
def sample_zarr_path(temp_dir):
    """Sample Zarr array for tile testing."""

@pytest.fixture
def mock_hypha_server():
    """Mock Hypha-RPC server."""

@pytest.fixture
def microscopy_metadata():
    """Sample metadata structures."""
```

## Best Practices

### 1. **Test Behavior, Not Implementation**
```python
# Good: Test the expected outcome
def test_autofocus_finds_optimal_position():
    result = await run_autofocus()
    assert result["focus_score"] > 0.8

# Avoid: Testing internal details
```

### 2. **Use Descriptive Test Names**
```python
def test_stage_movement_returns_success_when_coordinates_are_valid():
    # Clear what the test does and expects
```

### 3. **Clean Resource Management**
```python
@pytest.fixture
def temp_dir():
    temp_dir = tempfile.mkdtemp()
    yield Path(temp_dir)
    shutil.rmtree(temp_dir, ignore_errors=True)  # Always cleanup
```

### 4. **Mock External Dependencies**
```python
@patch('agent_lens.hardware.microscope_control')
def test_capture_with_mocked_hardware(mock_microscope):
    mock_microscope.capture.return_value = sample_image
    result = await capture_image()
    assert result is not None
```

## Working Examples

### **Similarity Service Test** (Currently Passing)
```python
@pytest.mark.slow
async def test_find_similar_cells():
    """Test adding cell images and finding similar ones."""
    # Register real service with CLIP model
    service_info = await register_similarity_search_service.start_hypha_service(
        server, "image-text-similarity-search-test"
    )
    
    # Add test images
    for i, (image_bytes, annotation) in enumerate(zip(cell_images, annotations)):
        result = await similarity_service.add_cell(image_bytes, f"test_cell_{i}", annotation)
        assert result["status"] == "success"
    
    # Search for similar cells
    results = await similarity_service.find_similar_cells(query_image, top_k=3)
    assert len(results) <= 3
    for result in results:
        assert "similarity" in result
        assert 0 <= result["similarity"] <= 1
```

### **Basic Functionality Test** (Currently Passing)
```python
@pytest.mark.unit
def test_tile_coordinate_calculation():
    """Test tile coordinate calculations."""
    coords = calculate_tile_coordinates(image_width=2048, tile_size=256)
    assert len(coords) == 64  # 8x8 grid
    assert all(isinstance(coord, tuple) for coord in coords)
```

## Running Specific Tests

```bash
# Run by marker
pytest -m unit                    # Fast unit tests only
pytest -m "not slow"             # Exclude slow tests
pytest -m integration            # Integration tests only

# Run specific files
pytest agent_lens/tests/test_basic.py -v
pytest agent_lens/tests/test_similarity_service.py::TestSimilaritySearchService::test_find_similar_cells -v

# Debug options
pytest --pdb                     # Drop into debugger on failure
pytest -x                       # Stop on first failure
pytest -s                       # Show print statements
```

## Frontend Testing

```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import ControlButton from '../ControlButton';

test('control button handles click events', async () => {
  const mockOnClick = jest.fn();
  render(<ControlButton label="Test" onClick={mockOnClick} />);
  
  await userEvent.click(screen.getByRole('button'));
  
  expect(mockOnClick).toHaveBeenCalledTimes(1);
});
```

## Test Runner Features

The `scripts/run_tests.py` provides comprehensive testing options:

```bash
# Development workflow
python scripts/run_tests.py --type fast --coverage

# CI/CD pipeline
python scripts/run_tests.py --type all --coverage

# Check dependencies
python scripts/run_tests.py --check-deps

# Backend only
python scripts/run_tests.py --backend-only
```

## Dependencies for Testing

### **Required Python Packages**
- `pytest` - Test framework
- `pytest-asyncio` - Async test support
- `pytest-cov` - Coverage reporting
- `faiss-cpu` - Vector similarity search
- `torch` - PyTorch for CLIP
- `clip` - OpenAI CLIP model

### **Optional Frontend Packages**
- `jest` - JavaScript test framework
- `@testing-library/react` - React component testing
- `@testing-library/user-event` - User interaction simulation

## Performance & CI/CD

### **Performance Requirements**
- Unit tests: < 2 seconds total
- Integration tests: < 30 seconds
- Slow tests: < 5 minutes
- Coverage target: > 80%

### **GitHub Actions Integration**
```yaml
# .github/workflows/test.yml
- name: Run Tests
  run: |
    python scripts/run_tests.py --type fast --coverage
    python scripts/run_tests.py --type slow
```

## Troubleshooting

### **Common Issues**

1. **Import Errors**: Ensure all dependencies are installed
   ```bash
   pip install -r requirements_test.txt
   pip install faiss-cpu torch git+https://github.com/openai/CLIP.git
   ```

2. **Async Test Failures**: Check async/await usage
   ```python
   @pytest.mark.asyncio
   async def test_async_function():
       result = await async_function()  # Don't forget await
   ```

3. **Service Connection Issues**: Verify environment variables
   ```bash
   export AGENT_LENS_WORKSPACE_TOKEN=<your_token>
   ```

## Next Steps

### **Expanding Test Coverage**
- **Hardware Control Tests**: Microscope positioning, camera control
- **Image Analysis Tests**: Segmentation, feature detection
- **Workflow Tests**: Complete imaging pipelines
- **Performance Tests**: Large dataset handling

### **Contributing New Tests**
1. Write tests following existing patterns
2. Cover both success and failure cases
3. Add integration tests for new workflows
4. Update documentation for new test categories

---

**🎯 Result**: A robust, professional testing infrastructure that ensures reliability and enables confident development of the Agent-Lens smart microscopy platform. 