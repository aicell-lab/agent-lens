#!/bin/bash

echo "🧪 Running Integration Tests..."
echo ""

# Install dependencies if needed
if [ ! -d "tests/node_modules" ]; then
    echo "Installing dependencies..."
    cd tests && npm install
    cd ..
fi

# Test 1: Hypha Connection
echo "Test 1: Hypha Connection"
cd tests && npm run test:hypha-agents:connection
if [ $? -ne 0 ]; then
    echo "❌ Hypha connection test failed"
    exit 1
fi
echo ""

# Test 2: Kernel Service
echo "Test 2: Kernel Service (Python Execution)"
cd tests && npm run test:hypha-agents:kernel
if [ $? -ne 0 ]; then
    echo "❌ Kernel service test failed"
    exit 1
fi
echo ""

# Test 3: Full Integration
echo "Test 3: Full Integration"
cd tests && npm run test:hypha-agents:integration
if [ $? -ne 0 ]; then
    echo "❌ Integration test failed"
    exit 1
fi
echo ""

echo "✅ All integration tests passed!"

