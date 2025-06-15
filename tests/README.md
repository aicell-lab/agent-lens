# Agent-Lens Test Suite

This directory contains comprehensive tests for the Agent-Lens microscopy platform.

## Test Categories

### Backend Tests
- **Unit Tests**: Fast, isolated tests with mocks
- **Integration Tests**: Tests with real service interactions
- **Slow Tests**: Long-running tests (marked as slow)

### Frontend Tests
- **React Tests**: Component and unit tests for the React frontend
- **Frontend Service Tests**: E2E tests for the FastAPI frontend service using Playwright

## Setup

### 1. Install Dependencies

```bash
# Install test dependencies
pip install -r requirements-test.txt

# Install the package in development mode
pip install -e .

# Install Playwright browsers (for frontend service tests)
playwright install chromium
```

### 2. Environment Variables

Set the required environment variable for integration tests:

```bash
export WORKSPACE_TOKEN="your_workspace_token_here"
```

## Running Tests

### Quick Start - Run Fast Tests Only
```bash
python scripts/run_tests.py --type fast
```

### Backend Tests Only
```bash
python scripts/run_tests.py --backend-only --type fast
```

### Frontend Service Tests (with Playwright)
```bash
python scripts/run_frontend_tests.py
```

### All Tests with Coverage
```bash
python scripts/run_tests.py --coverage --type all
```

### Test Type Options

- `--type fast`: Run fast tests only (excludes slow tests)
- `--type unit`: Run unit tests only
- `--type integration`: Run integration tests only
- `--type slow`: Run slow/long-running tests only
- `--type all`: Run all tests

### Additional Options

- `--frontend-service`: Include frontend service tests with Playwright
- `--verbose`: Verbose output
- `--coverage`: Generate coverage reports
- `--check-deps`: Only check if dependencies are installed

## Test Structure

```
tests/
├── conftest.py                  # Test configuration and fixtures
├── test_basic.py               # Basic functionality tests
├── test_artifact_manager.py    # Artifact manager tests
├── test_similarity_service.py  # Similarity service tests
├── test_frontend_service.py    # Frontend service tests (Playwright)
└── README.md                   # This file
```

## Frontend Service Tests

The frontend service tests (`test_frontend_service.py`) use Playwright to test the FastAPI frontend service:

1. **Service Registration**: Tests that the service can be registered with Hypha
2. **Root Endpoint**: Tests that the main page loads correctly
3. **Static Assets**: Tests that static files are served
4. **Health Checks**: Tests service stability
5. **Integration**: End-to-end testing of the complete service

These tests:
- Register a unique frontend service instance
- Keep the service running during tests
- Use Playwright to interact with the service
- Take screenshots for debugging
- Perform proper cleanup

## Environment Setup

### Required Environment Variables

- `WORKSPACE_TOKEN`: Your Hypha workspace token (required for integration tests)

### Optional Environment Variables

- `TEST_SERVER_URL`: Hypha server URL (defaults to https://hypha.aicell.io)
- `TEST_WORKSPACE`: Workspace name (defaults to agent-lens)

## Troubleshooting

### Common Issues

1. **Missing Dependencies**: Run `python scripts/run_tests.py --check-deps`
2. **Playwright Issues**: Run `playwright install chromium`
3. **Token Issues**: Ensure `WORKSPACE_TOKEN` is set correctly
4. **Package Not Found**: Run `pip install -e .`

### Debug Mode

For debugging test failures, use verbose mode and check the generated screenshots:

```bash
python scripts/run_frontend_tests.py -v
```

Screenshots are saved to `/tmp/frontend_test_*.png` for debugging.

## CI/CD Integration

The test suite is designed to work in CI/CD environments:

```bash
# For GitHub Actions or similar
export WORKSPACE_TOKEN=${{ secrets.WORKSPACE_TOKEN }}
python scripts/run_tests.py --type fast --coverage
```

## Performance

- **Fast tests**: < 2 seconds each (recommended for development)
- **Integration tests**: 5-30 seconds each (real service communication)
- **Slow tests**: > 30 seconds each (AI models, large datasets)
- **Frontend service tests**: 30-60 seconds (Playwright automation)

Choose the appropriate test type based on your development workflow. 