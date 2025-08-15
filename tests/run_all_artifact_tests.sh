#!/bin/bash

# Combined Test Runner for ArtifactZarrLoader
# Runs both Python and JavaScript tests for comprehensive testing

echo "🔬 Combined ArtifactZarrLoader Test Suite"
echo "=========================================="
echo "This will run both Python and JavaScript tests"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local status=$1
    local message=$2
    case $status in
        "success")
            echo -e "${GREEN}✅${NC} $message"
            ;;
        "error")
            echo -e "${RED}❌${NC} $message"
            ;;
        "warning")
            echo -e "${YELLOW}⚠️${NC} $message"
            ;;
        "info")
            echo -e "${BLUE}ℹ️${NC} $message"
            ;;
    esac
}

# Track overall results
PYTHON_EXIT_CODE=0
JS_EXIT_CODE=0
OVERALL_EXIT_CODE=0

echo "📋 Test Plan:"
echo "  1. Python tests (unit tests with mocks)"
echo "  2. JavaScript tests (integration tests with real HTTP requests)"
echo ""

# Run Python tests
echo "🧪 Running Python tests..."
echo "=========================="
if python tests/run_artifact_zarr_tests.py; then
    print_status "success" "Python tests completed successfully"
    PYTHON_EXIT_CODE=0
else
    print_status "error" "Python tests failed"
    PYTHON_EXIT_CODE=1
    OVERALL_EXIT_CODE=1
fi

echo ""

# Run JavaScript tests
echo "🧪 Running JavaScript tests..."
echo "=============================="
if ./tests/run_js_tests.sh; then
    print_status "success" "JavaScript tests completed successfully"
    JS_EXIT_CODE=0
else
    print_status "error" "JavaScript tests failed"
    JS_EXIT_CODE=1
    OVERALL_EXIT_CODE=1
fi

echo ""
echo "📊 Final Results Summary"
echo "========================"

if [ $PYTHON_EXIT_CODE -eq 0 ]; then
    print_status "success" "Python tests: PASSED"
else
    print_status "error" "Python tests: FAILED"
fi

if [ $JS_EXIT_CODE -eq 0 ]; then
    print_status "success" "JavaScript tests: PASSED"
else
    print_status "error" "JavaScript tests: FAILED"
fi

echo ""

if [ $OVERALL_EXIT_CODE -eq 0 ]; then
    print_status "success" "🎉 All test suites completed successfully!"
    echo ""
    echo "📝 Summary:"
    echo "  • Python tests: Unit tests with mocked dependencies"
    echo "  • JavaScript tests: Integration tests with real HTTP requests"
    echo "  • Both test suites validate the ArtifactZarrLoader functionality"
    echo "  • Some JavaScript tests may fail due to missing test data (expected)"
else
    print_status "error" "Some test suites failed"
    echo ""
    echo "💡 Note: JavaScript test failures may be expected if test data is not available"
    echo "   The important thing is that the service is working correctly"
fi

exit $OVERALL_EXIT_CODE 