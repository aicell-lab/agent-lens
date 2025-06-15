#!/usr/bin/env python3
"""
Comprehensive test runner for Agent-Lens microscopy platform.

This script provides different test execution modes:
- Unit tests: Fast, isolated tests with mocks
- Integration tests: Tests with real service interactions
- Slow tests: Long-running tests (marked as slow)
- Coverage: Tests with coverage reporting
"""

import sys
import subprocess
import argparse
import os
from pathlib import Path

def run_command(cmd, description):
    """Run a command and handle errors."""
    print(f"\n{'='*60}")
    print(f"Running: {description}")
    print(f"Command: {' '.join(cmd)}")
    print(f"{'='*60}")
    
    try:
        result = subprocess.run(cmd, check=True, capture_output=True, text=True)
        print(result.stdout)
        if result.stderr:
            print("STDERR:", result.stderr)
        return True
    except subprocess.CalledProcessError as e:
        print(f"ERROR: {description} failed!")
        print(f"Exit code: {e.returncode}")
        print(f"STDOUT: {e.stdout}")
        print(f"STDERR: {e.stderr}")
        return False

def run_backend_tests(test_type="all", verbose=False, coverage=False):
    """Run Python backend tests."""
    cmd = ["python", "-m", "pytest"]
    
    # Add verbosity
    if verbose:
        cmd.append("-v")
    
    # Add coverage
    if coverage:
        cmd.extend(["--cov=agent_lens", "--cov-report=html", "--cov-report=term"])
    
    # Add test markers
    if test_type == "unit":
        cmd.extend(["-m", "unit"])
    elif test_type == "integration":
        cmd.extend(["-m", "integration"])
    elif test_type == "slow":
        cmd.extend(["-m", "slow"])
    elif test_type == "fast":
        cmd.extend(["-m", "not slow"])
    
    # Add test paths (only if they exist)
    test_paths = []
    if Path("tests/").exists():
        test_paths.append("tests/")
    
    if test_paths:
        cmd.extend(test_paths)
    else:
        cmd.append(".")  # Search current directory if no test dirs found
    
    return run_command(cmd, f"Backend tests ({test_type})")

def run_frontend_tests(test_type="all", verbose=False, coverage=False):
    """Run React frontend tests."""
    os.chdir("frontend")
    
    try:
        cmd = ["npm", "test"]
        
        if coverage:
            cmd = ["npm", "run", "test:coverage"]
        
        # Set environment for CI mode (non-interactive)
        env = os.environ.copy()
        env["CI"] = "true"
        
        # Add non-interactive flag to prevent Jest from hanging
        cmd.extend(["--watchAll=false"])
        
        return run_command(cmd, f"Frontend Jest tests ({test_type})")
    finally:
        os.chdir("..")

def run_frontend_service_tests(test_type="all", verbose=False, coverage=False):
    """Run FastAPI frontend service tests with Playwright."""
    cmd = ["python", "scripts/run_frontend_tests.py"]
    
    # The frontend service test runner handles its own setup
    return run_command(cmd, f"Frontend service tests ({test_type})")

def check_dependencies(check_frontend=True):
    """Check if required dependencies are installed."""
    print("Checking dependencies...")
    
    # Check Python dependencies
    try:
        import pytest
        import pytest_asyncio
        import pytest_cov
        print("✓ Python test dependencies installed")
    except ImportError as e:
        print(f"✗ Missing Python dependency: {e}")
        print("Run: pip install -r requirements-test.txt")
        return False
    
    # Check Playwright dependency
    try:
        import playwright
        print("✓ Playwright dependency installed")
    except ImportError:
        print("⚠ Playwright not installed (needed for frontend service tests)")
        print("Run: pip install playwright && playwright install chromium")
    
    # Check if agent_lens package is installed
    try:
        import agent_lens
        print("✓ agent_lens package is available")
    except ImportError:
        print("⚠ agent_lens package not installed as editable package")
        print("Installing in development mode...")
        try:
            result = subprocess.run(
                ["pip", "install", "-e", "."], 
                capture_output=True, 
                text=True,
                check=True
            )
            print("✓ agent_lens package installed in development mode")
        except subprocess.CalledProcessError as e:
            print(f"✗ Failed to install agent_lens package: {e}")
            print("Please run: pip install -e .")
            return False
    
    # Check Node dependencies (if frontend directory exists and check_frontend is True)
    if check_frontend and Path("frontend").exists():
        try:
            # Check for package.json first
            package_json_path = Path("frontend/package.json")
            if not package_json_path.exists():
                print("✗ Frontend package.json not found")
                return False
                
            # Check if node_modules exists
            node_modules_path = Path("frontend/node_modules")
            if not node_modules_path.exists():
                print("✗ Frontend test dependencies missing")
                print("Run: cd frontend && npm install")
                return False
                
            # Check for specific dependencies we need (Vite for building)
            result = subprocess.run(
                ["npm", "list", "vite"], 
                cwd="frontend", 
                capture_output=True, 
                text=True
            )
            if result.returncode == 0:
                print("✓ Frontend test dependencies installed")
            else:
                print("✗ Frontend test dependencies missing")
                print("Run: cd frontend && npm install")
                return False
        except FileNotFoundError:
            print("✗ npm not found. Please install Node.js")
            return False
    elif not check_frontend:
        print("⚠ Skipping frontend dependency check")
    
    return True

def generate_test_report():
    """Generate a comprehensive test report."""
    print("\n" + "="*60)
    print("GENERATING TEST REPORT")
    print("="*60)
    
    # Backend coverage report
    if Path("htmlcov").exists():
        print("✓ Backend coverage report generated: htmlcov/index.html")
    
    # Frontend coverage report
    if Path("frontend/coverage").exists():
        print("✓ Frontend coverage report generated: frontend/coverage/lcov-report/index.html")
    
    print("\nTest execution completed!")

def main():
    parser = argparse.ArgumentParser(description="Run Agent-Lens tests")
    parser.add_argument(
        "--type", 
        choices=["all", "unit", "integration", "slow", "fast"],
        default="fast",
        help="Type of tests to run"
    )
    parser.add_argument(
        "--backend-only", 
        action="store_true",
        help="Run only backend tests"
    )
    parser.add_argument(
        "--frontend-only", 
        action="store_true",
        help="Run only frontend tests"
    )
    parser.add_argument(
        "--frontend-service", 
        action="store_true",
        help="Also run frontend service tests with Playwright"
    )
    parser.add_argument(
        "--coverage", 
        action="store_true",
        help="Generate coverage reports"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Verbose output"
    )
    parser.add_argument(
        "--check-deps",
        action="store_true",
        help="Only check dependencies"
    )
    
    args = parser.parse_args()
    
    # Change to project root
    script_dir = Path(__file__).parent
    project_root = script_dir.parent
    os.chdir(project_root)
    
    print("Agent-Lens Test Runner")
    print(f"Project root: {project_root}")
    
    # Check dependencies
    check_frontend_deps = not args.backend_only
    if not check_dependencies(check_frontend=check_frontend_deps):
        sys.exit(1)
    
    if args.check_deps:
        print("✓ All dependencies are installed")
        sys.exit(0)
    
    success = True
    
    # Run backend tests
    if not args.frontend_only:
        print(f"\nRunning backend tests (type: {args.type})...")
        if not run_backend_tests(args.type, args.verbose, args.coverage):
            success = False
    
    # Run frontend tests
    if not args.backend_only and Path("frontend").exists():
        print(f"\nRunning frontend tests (type: {args.type})...")
        if not run_frontend_tests(args.type, args.verbose, args.coverage):
            success = False
    
    # Run frontend service tests if requested
    if args.frontend_service or (not args.backend_only and not args.frontend_only):
        print(f"\nRunning frontend service tests (type: {args.type})...")
        if not run_frontend_service_tests(args.type, args.verbose, args.coverage):
            success = False
    
    # Generate report
    if args.coverage:
        generate_test_report()
    
    if success:
        print("\n🎉 All tests passed!")
        sys.exit(0)
    else:
        print("\n❌ Some tests failed!")
        sys.exit(1)

if __name__ == "__main__":
    main() 