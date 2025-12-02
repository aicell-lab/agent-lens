#!/bin/bash

# JavaScript Test Runner for ArtifactZarrLoader
# This script runs the frontend integration tests for ArtifactZarrLoader

echo "🔬 JavaScript ArtifactZarrLoader Test Runner"
echo "=============================================="

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed or not in PATH"
    echo "Please install Node.js to run JavaScript tests"
    exit 1
fi

# Check Node.js version
NODE_VERSION=$(node --version)
echo "🔧 Node.js version: $NODE_VERSION"

# Check if we're in the right directory
if [ ! -f "frontend/utils/artifactZarrLoader.js" ]; then
    echo "❌ artifactZarrLoader.js not found"
    echo "Please run this script from the project root directory"
    exit 1
fi

# Run the JavaScript test
echo "📁 Running frontend integration tests..."
echo "🚀 Testing ArtifactZarrLoader integration..."
echo ""

# Run the test with Node.js from the tests directory
cd tests
node test_frontend_integration.js

# Capture exit code
EXIT_CODE=$?

echo ""
echo "=============================================="

if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ JavaScript tests completed successfully"
else
    echo "❌ JavaScript tests failed (exit code: $EXIT_CODE)"
fi

exit $EXIT_CODE 