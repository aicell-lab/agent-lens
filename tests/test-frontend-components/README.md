# Frontend Components Test Suite

This directory contains comprehensive tests for frontend components used in the Agent-Lens microscopy platform.

## Test Structure

```
test-frontend-components/
├── README.md                           # This file
├── run_tests.js                        # Main test runner
├── test_tile_processing_manager.js     # TileProcessingManager tests
└── test_layer_panel.js                 # LayerPanel component tests
```

## Components Tested

### 1. TileProcessingManager
Tests the core tile processing functionality including:
- Multi-channel data loading and processing
- Color management and contrast adjustment
- Channel merging with additive blending
- Error handling and edge cases
- Browser API mocking for Node.js environment

### 2. LayerPanel
Tests the UI component logic including:
- Channel configuration management
- Multi-channel loading decisions
- Event handling and dispatching
- UI state management
- Integration with parent components

## Running Tests

### Run All Tests
```bash
node tests/test-frontend-components/run_tests.js
```

### Run Specific Component Tests
```bash
# Only TileProcessingManager tests
node tests/test-frontend-components/run_tests.js --tile-processing

# Only LayerPanel tests
node tests/test-frontend-components/run_tests.js --layer-panel
```

### Verbose Output
```bash
node tests/test-frontend-components/run_tests.js --verbose
```

### Individual Test Files
```bash
# Run TileProcessingManager tests directly
node tests/test-frontend-components/test_tile_processing_manager.js

# Run LayerPanel tests directly
node tests/test-frontend-components/test_layer_panel.js
```

## Test Features

### Browser API Mocking
The tests include comprehensive mocking of browser APIs for Node.js compatibility:
- `document.createElement` for canvas operations
- `Image` class for image loading simulation
- `CustomEvent` for event handling
- Canvas 2D context methods

### Mock Services
Tests use mock services to simulate:
- Microscope control service responses
- Artifact Zarr loader responses
- Service failure scenarios

### Comprehensive Coverage
Each test suite covers:
- ✅ Happy path scenarios
- ✅ Error handling and edge cases
- ✅ Input validation
- ✅ State management
- ✅ Integration points

## Integration with CI/CD

These tests are integrated with the GitHub Actions workflow in `.github/workflows/test.yml` and run as part of the automated test suite.

## Test Results

Each test provides:
- ✅/❌ Pass/fail status
- ⏱️ Execution duration
- 📊 Detailed result summary
- 🔍 Error details for failed tests

## Dependencies

- Node.js 20+
- ES6 modules support
- No external testing frameworks (vanilla JavaScript)

## Adding New Tests

To add tests for new frontend components:

1. Create a new test file: `test_[component_name].js`
2. Follow the existing test structure and patterns
3. Add the component to the test runner in `run_tests.js`
4. Update this README with the new component

## Troubleshooting

### Common Issues

1. **Import Errors**: Ensure the component files exist and are properly exported
2. **Browser API Errors**: Check that browser API mocking is properly implemented
3. **Async Test Failures**: Ensure proper async/await patterns are used

### Debug Mode

Run tests with verbose output to see detailed execution:
```bash
node tests/test-frontend-components/run_tests.js --verbose
```
