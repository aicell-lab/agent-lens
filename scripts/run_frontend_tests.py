#!/usr/bin/env python3
"""
Frontend test runner for Agent-Lens FastAPI service.
Handles Playwright installation and test execution.
"""

import subprocess
import sys
import os
import asyncio
from pathlib import Path

def ensure_playwright_installed():
    """Ensure Playwright browsers are installed."""
    print("🎭 Checking Playwright installation...")
    
    try:
        # Check if playwright is installed
        import playwright
        print("✅ Playwright package found")
        
        # Install browsers if needed
        print("🔄 Installing/updating Playwright browsers...")
        result = subprocess.run([
            sys.executable, "-m", "playwright", "install", "chromium"
        ], capture_output=True, text=True)
        
        if result.returncode != 0:
            print(f"⚠️  Playwright browser installation warning: {result.stderr}")
        else:
            print("✅ Playwright browsers ready")
            
    except ImportError:
        print("❌ Playwright not installed. Installing...")
        subprocess.run([sys.executable, "-m", "pip", "install", "playwright"], check=True)
        subprocess.run([sys.executable, "-m", "playwright", "install", "chromium"], check=True)
        print("✅ Playwright installed successfully")

def check_environment():
    """Check required environment variables."""
    print("🔍 Checking environment...")
    
    required_vars = ["WORKSPACE_TOKEN"]
    missing_vars = []
    
    for var in required_vars:
        if not os.getenv(var):
            missing_vars.append(var)
    
    if missing_vars:
        print(f"❌ Missing required environment variables: {', '.join(missing_vars)}")
        print("Please set WORKSPACE_TOKEN in your environment.")
        return False
    
    print("✅ Environment variables configured")
    return True

def run_tests():
    """Run the frontend service tests."""
    print("🚀 Starting frontend service tests...")
    
    # Get the project root directory
    project_root = Path(__file__).parent.parent
    test_file = project_root / "tests" / "test_frontend_service.py"
    
    if not test_file.exists():
        print(f"❌ Test file not found: {test_file}")
        return False
    
    # Run pytest with verbose output
    cmd = [
        sys.executable, "-m", "pytest", 
        str(test_file),
        "-v", "-s",  # Verbose and don't capture output
        "--tb=short",  # Short traceback format
        "--asyncio-mode=auto",  # Auto detect asyncio tests
    ]
    
    print(f"🔧 Running command: {' '.join(cmd)}")
    
    try:
        result = subprocess.run(cmd, cwd=project_root)
        return result.returncode == 0
    except KeyboardInterrupt:
        print("\n⚠️  Tests interrupted by user")
        return False
    except Exception as e:
        print(f"❌ Error running tests: {e}")
        return False

def main():
    """Main test runner function."""
    print("🧪 Agent-Lens Frontend Service Test Runner")
    print("=" * 50)
    
    # Check environment first
    if not check_environment():
        sys.exit(1)
    
    # Ensure Playwright is installed
    try:
        ensure_playwright_installed()
    except Exception as e:
        print(f"❌ Failed to setup Playwright: {e}")
        sys.exit(1)
    
    # Run the tests
    success = run_tests()
    
    if success:
        print("\n✅ All frontend tests passed!")
        sys.exit(0)
    else:
        print("\n❌ Some frontend tests failed!")
        sys.exit(1)

if __name__ == "__main__":
    main() 