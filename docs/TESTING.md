# Testing Guide for Agent-Lens

This document provides comprehensive guidance on testing the Agent-Lens smart microscopy platform.

## Overview

Agent-Lens uses a multi-layered testing approach to ensure reliability and quality:

- **Unit Tests**: Fast, isolated tests with mocks
- **Integration Tests**: Tests with real service interactions  
- **End-to-End Tests**: Complete workflow testing
- **Frontend Tests**: React component and UI testing

## Quick Start

### Install Test Dependencies

```bash
# Backend testing dependencies
pip install -r requirements_test.txt

# Frontend testing dependencies (if working with UI)
cd frontend
npm install
cd ..
```

### Run Tests

```bash
# Run all fast tests (recommended for development)
python scripts/run_tests.py --type fast

# Run with coverage
python scripts/run_tests.py --type fast --coverage

# Run only unit tests
python scripts/run_tests.py --type unit

# Run only backend tests
python scripts/run_tests.py --backend-only

# Check dependencies
python scripts/run_tests.py --check-deps
```

## Test Structure

### Backend Tests (`agent_lens/tests/`)

```
agent_lens/tests/
├── conftest.py              # Shared fixtures and configuration
├── test_similarity_service.py # Vector similarity search
└── __pycache__/
```

### Frontend Tests (`frontend/components/__tests__/`)

```
frontend/
├── components/__tests__/
│   ├── Notification.test.jsx
│   ├── ControlButton.test.jsx
│   └── ...
├── jest.config.js
├── babel.config.js
└── src/setupTests.js
```

## Test Categories

### Unit Tests (`@pytest.mark.unit`)

Fast, isolated tests that mock external dependencies:

```python
@pytest.mark.unit
async def test_zarr_tile_extraction(self, sample_zarr_path, sample_tile_data):
    """Test tile extraction from Zarr arrays."""
    tile_manager = ZarrTileManager(str(sample_zarr_path))
    
    # Mock external dependencies
    with patch.object(tile_manager, '_extract_tile_data', return_value=test_tile):
        tile_image = await tile_manager.get_tile_image(0, 0, 0, 256)
        
        assert isinstance(tile_image, Image.Image)
        assert tile_image.size == (256, 256)
```

### Integration Tests (`@pytest.mark.integration`)

Tests that verify service interactions and data flow:

```python
@pytest.mark.integration
async def test_complete_imaging_workflow(self, mock_services, sample_image):
    """Test complete workflow from capture to storage."""
    # Test real service interactions with mocked hardware
    await move_stage(x=1000, y=2000, z=150)
    await run_autofocus()
    capture_result = await capture_image(channel="BF", exposure=50)
    save_result = await save_annotated_image(capture_result, annotations)
    
    assert save_result["status"] == "saved"
```

### Slow Tests (`@pytest.mark.slow`)

Long-running tests that may involve real hardware or large datasets:

```python
@pytest.mark.slow
async def test_full_dataset_workflow(self, temp_dir, microscopy_metadata):
    """Test complete dataset upload/download workflow."""
    # Create realistic large dataset
    dataset_path = create_large_zarr_dataset(temp_dir)
    
    # Test upload and download
    dataset_id = await upload_zarr_dataset(dataset_path, metadata)
    await download_zarr_dataset(dataset_id, download_path)
```

## Test Fixtures

### Core Fixtures (from `conftest.py`)

```python
# Temporary directories for test data
@pytest.fixture
def temp_dir():
    """Create temporary directory for test files."""

# Sample microscopy data
@pytest.fixture
def sample_zarr_path(temp_dir):
    """Create sample Zarr array for testing."""

@pytest.fixture
def sample_image():
    """Generate realistic microscopy image."""

# Mock services
@pytest.fixture
def mock_hypha_server():
    """Mock Hypha server for service testing."""

@pytest.fixture
def mock_microscope_hardware():
    """Mock microscope hardware for testing."""
```

### Using Fixtures

```python
def test_image_processing(sample_image, temp_dir):
    """Test using multiple fixtures."""
    # sample_image and temp_dir are automatically provided
    processed_image = process_image(sample_image)
    save_path = temp_dir / "processed.png"
    processed_image.save(save_path)
    
    assert save_path.exists()
```

## Frontend Testing

### Component Testing

```jsx
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ControlButton from '../ControlButton';

test('calls onClick when button is clicked', async () => {
  const user = userEvent.setup();
  const mockOnClick = jest.fn();
  
  render(<ControlButton label="Test" onClick={mockOnClick} />);
  
  await user.click(screen.getByRole('button'));
  
  expect(mockOnClick).toHaveBeenCalledTimes(1);
});
```

### Mocking External Dependencies

```jsx
// Mock Hypha-RPC in setupTests.js
jest.mock('hypha-rpc', () => ({
  connect_to_server: jest.fn().mockResolvedValue({
    get_service: jest.fn().mockResolvedValue({}),
    config: { workspace: 'test-workspace' }
  })
}));
```

## Best Practices

### Writing Good Tests

1. **Test Behavior, Not Implementation**
   ```python
   # Good: Test the behavior
   def test_stage_moves_to_correct_position():
       result = await move_stage(x=10, y=20)
       assert result["position"]["x"] == 1000
   
   # Avoid: Testing internal implementation details
   ```

2. **Use Descriptive Test Names**
   ```python
   def test_autofocus_returns_success_when_contrast_algorithm_finds_focus():
       # Clear what the test does and expects
   ```

3. **Arrange, Act, Assert Pattern**
   ```python
   def test_image_tile_extraction():
       # Arrange
       tile_manager = ZarrTileManager(zarr_path)
       
       # Act
       tile = await tile_manager.get_tile_image(0, 0, 0, 256)
       
       # Assert
       assert tile.size == (256, 256)
   ```


### Test Data Management

1. **Use Realistic Test Data**
   ```python
   def create_realistic_cell_image():
       """Create image that looks like real microscopy data."""
       # Generate cell-like structures, not random noise
   ```

2. **Clean Up Resources**
   ```python
   @pytest.fixture
   def temp_dir():
       temp_dir = tempfile.mkdtemp()
       yield Path(temp_dir)
       shutil.rmtree(temp_dir, ignore_errors=True)  # Cleanup
   ```

3. **Use Factories for Complex Data**
   ```python
   class MicroscopyDataFactory:
       @staticmethod
       def create_multi_channel_image(channels=None):
           # Generate realistic multi-channel data
   ```

## Running Specific Tests

### By Test Type
```bash
# Unit tests only
pytest -m unit

# Integration tests only  
pytest -m integration

# Exclude slow tests
pytest -m "not slow"
```

### With Coverage
```bash
# Generate coverage report
pytest --cov=agent_lens --cov-report=html

# View coverage report
open htmlcov/index.html
```

## Continuous Integration

### GitHub Actions Integration

The test suite integrates with GitHub Actions for automated testing:

```yaml
# .github/workflows/test.yml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.10'
      - name: Install dependencies
        run: pip install -r requirements_test.txt
      - name: Run tests
        run: python scripts/run_tests.py --type fast --coverage
```

## Debugging Tests

### Common Issues

1. **Async Test Failures**
   ```python
   # Ensure proper async/await usage
   @pytest.mark.asyncio
   async def test_async_function():
       result = await async_function()  # Don't forget await
   ```

2. **Mock Not Working**
   ```python
   # Patch the right location
   @patch('agent_lens.module.function')  # Where it's used
   # Not @patch('original.module.function')  # Where it's defined
   ```

3. **Fixture Scope Issues**
   ```python
   # Use appropriate scope
   @pytest.fixture(scope="session")  # For expensive setup
   @pytest.fixture(scope="function")  # For test isolation
   ```

### Debugging Commands

```bash
# Run with verbose output
pytest -v

# Stop on first failure
pytest -x

# Drop into debugger on failure
pytest --pdb

# Run specific test with output
pytest -s test_file.py::test_function
```

## Performance Testing

### Benchmarking Critical Paths

```python
import time

def test_tile_loading_performance():
    """Ensure tile loading meets performance requirements."""
    start_time = time.time()
    
    tile = await load_large_tile()
    
    elapsed = time.time() - start_time
    assert elapsed < 0.5  # Should load in under 500ms
```

### Memory Usage Testing

```python
import psutil
import os

def test_memory_usage_during_large_dataset_processing():
    """Ensure memory usage stays within bounds."""
    process = psutil.Process(os.getpid())
    initial_memory = process.memory_info().rss
    
    process_large_dataset()
    
    final_memory = process.memory_info().rss
    memory_increase = final_memory - initial_memory
    
    # Should not increase memory by more than 1GB
    assert memory_increase < 1024 * 1024 * 1024
```

## Contributing Tests

When adding new features:

1. **Write tests first** (TDD approach)
2. **Cover edge cases** and error conditions
3. **Test both success and failure paths**
4. **Add integration tests** for new workflows
5. **Update documentation** if adding new test patterns

### Test Review Checklist

- [ ] Tests are fast and reliable
- [ ] External dependencies are mocked
- [ ] Test names are descriptive
- [ ] Edge cases are covered
- [ ] Cleanup is handled properly
- [ ] Tests follow existing patterns

## Resources

- [pytest documentation](https://docs.pytest.org/)
- [React Testing Library](https://testing-library.com/docs/react-testing-library/intro/)
- [Jest documentation](https://jestjs.io/docs/getting-started)
- [Python unittest.mock](https://docs.python.org/3/library/unittest.mock.html) 