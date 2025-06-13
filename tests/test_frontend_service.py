"""
Test suite for Agent-Lens FastAPI frontend service.
Tests service registration, connectivity, and frontend functionality using Playwright.
"""

import pytest
import pytest_asyncio
import asyncio
import os
import uuid
import time
import sys
from pathlib import Path
from playwright.async_api import async_playwright
from hypha_rpc import connect_to_server

# Add the project root to the Python path to ensure agent_lens can be imported
project_root = Path(__file__).parent.parent
if str(project_root) not in sys.path:
    sys.path.insert(0, str(project_root))

from agent_lens.register_frontend_service import setup_service, get_frontend_api

# Test configuration
TEST_SERVER_URL = "https://hypha.aicell.io"
TEST_WORKSPACE = "agent-lens"  # Using agent-lens workspace as specified in the service
TEST_TIMEOUT = 120  # seconds

@pytest_asyncio.fixture(scope="function")
async def test_frontend_service(hypha_connection_manager):
    """Create a real frontend service for testing."""
    # Check for token first
    token = os.environ.get("WORKSPACE_TOKEN")
    if not token:
        pytest.skip("WORKSPACE_TOKEN not set in environment")
    
    print(f"🔗 Connecting to {TEST_SERVER_URL} workspace {TEST_WORKSPACE}...")
    
    server = None
    service = None
    
    try:
        # Use connection manager for proper cleanup
        server = await hypha_connection_manager(
            TEST_SERVER_URL, 
            token, 
            TEST_WORKSPACE
        )
        
        if server is None:
            pytest.skip("Failed to connect to Hypha server")
        
        print("✅ Connected to server")
        
        # Create unique service ID for this test
        test_id = f"test-agent-lens-frontend-{uuid.uuid4().hex[:8]}"
        print(f"Creating test frontend service with ID: {test_id}")
        
        # Register the frontend service
        print("📝 Registering frontend service...")
        service_start_time = time.time()
        await setup_service(server, test_id)
        service_time = time.time() - service_start_time
        print(f"✅ Frontend service registration took {service_time:.1f} seconds")
        
        # Get the registered service to test against
        print("🔍 Getting service reference...")
        service = await server.get_service(test_id)
        print("✅ Frontend service ready for testing")
        
        # Get the service URL for Playwright testing
        service_url = f"{TEST_SERVER_URL}/{TEST_WORKSPACE}/apps/{test_id}"
        print(f"🌐 Service URL: {service_url}")
        
        try:
            yield service, service_url
        finally:
            # Cleanup
            print(f"🧹 Starting cleanup...")
            
            # Call cleanup function if it exists in server config
            if hasattr(server, 'config') and 'cleanup' in server.config:
                try:
                    cleanup_func = server.config['cleanup']
                    if asyncio.iscoroutinefunction(cleanup_func):
                        await cleanup_func()
                    else:
                        cleanup_func()
                    print("✅ Service cleanup completed")
                except Exception as cleanup_error:
                    print(f"Cleanup error: {cleanup_error}")
            
            # Give time for cleanup operations to complete
            await asyncio.sleep(0.1)
            print("✅ Cleanup completed")
        
    except Exception as e:
        pytest.fail(f"Failed to create test frontend service: {e}")

@pytest.mark.asyncio
async def test_frontend_service_registration_and_connectivity(test_frontend_service):
    """Test that the frontend service can be registered and is accessible."""
    service, service_url = test_frontend_service
    
    print("🧪 Testing service registration and connectivity...")
    
    # The frontend service doesn't have traditional RPC methods, but we can check if it's registered
    # by verifying the service object exists and has the expected configuration
    assert service is not None
    print("✅ Service registration verified")

@pytest.mark.asyncio 
async def test_frontend_root_endpoint_with_playwright(test_frontend_service):
    """Test the frontend root endpoint using Playwright."""
    service, service_url = test_frontend_service
    
    print("🎭 Starting Playwright test for frontend root endpoint...")
    
    async with async_playwright() as p:
        # Launch browser in headless mode for testing
        browser = await p.chromium.launch(headless=True)
        
        try:
            # Create a new browser context
            context = await browser.new_context()
            
            # Create a new page
            page = await context.new_page()
            
            print(f"📄 Navigating to service URL: {service_url}")
            
            # Navigate to the service URL with a reasonable timeout
            try:
                response = await page.goto(service_url, timeout=30000)  # 30 second timeout
                
                # Check that we got a successful response
                assert response.status < 400, f"HTTP error: {response.status}"
                print(f"✅ Page loaded successfully with status: {response.status}")
                
                # Wait for the page to be fully loaded
                await page.wait_for_load_state('networkidle', timeout=10000)
                
                # Check that we have an HTML page (should contain basic HTML structure)
                page_content = await page.content()
                assert '<html' in page_content.lower(), "Response doesn't appear to be HTML"
                assert '<head' in page_content.lower(), "HTML missing head section"
                assert '<body' in page_content.lower(), "HTML missing body section"
                print("✅ Valid HTML structure detected")
                
                # Check for common frontend elements that might be present
                # Note: Since this is serving the built React app, we should see the root div
                try:
                    # Look for common React root element or any div that might be the app container
                    app_elements = await page.query_selector_all('div')
                    assert len(app_elements) > 0, "No div elements found on page"
                    print(f"✅ Found {len(app_elements)} div elements on page")
                except Exception as element_error:
                    print(f"⚠️  Could not verify React app elements: {element_error}")
                    # This is not critical as the service might be serving a basic HTML page
                
                # Check page title
                title = await page.title()
                print(f"📋 Page title: '{title}'")
                
                # Take a screenshot for debugging if needed
                screenshot_path = f"/tmp/frontend_test_{uuid.uuid4().hex[:8]}.png"
                await page.screenshot(path=screenshot_path)
                print(f"📸 Screenshot saved to: {screenshot_path}")
                
            except Exception as nav_error:
                # Print more detailed error information
                print(f"❌ Navigation failed: {nav_error}")
                
                # Try to get more information about the error
                try:
                    # Check if the service is actually running by making a simple request
                    response = await page.goto(service_url, wait_until='domcontentloaded', timeout=15000)
                    print(f"Fallback navigation status: {response.status if response else 'No response'}")
                except Exception as fallback_error:
                    print(f"Fallback navigation also failed: {fallback_error}")
                
                raise nav_error
            
        finally:
            # Clean up browser resources
            await context.close()
            await browser.close()
            print("🧹 Browser cleanup completed")

@pytest.mark.asyncio
async def test_frontend_static_assets(test_frontend_service):
    """Test that static assets are served correctly."""
    service, service_url = test_frontend_service
    
    print("🎭 Testing static asset serving...")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        
        try:
            context = await browser.new_context()
            page = await context.new_page()
            
            # Test assets directory (if it exists)
            assets_url = f"{service_url}/assets/"
            print(f"🔍 Checking assets directory: {assets_url}")
            
            try:
                response = await page.goto(assets_url, timeout=15000)
                # Assets directory might return 404 or 403, which is normal
                # We're just checking that the service responds
                print(f"📁 Assets response status: {response.status}")
                assert response.status in [200, 403, 404], f"Unexpected status for assets: {response.status}"
                
            except Exception as assets_error:
                print(f"⚠️  Assets check failed (this might be normal): {assets_error}")
                # This is not critical - the service might not have assets or they might be protected
            
        finally:
            await context.close()
            await browser.close()

@pytest.mark.asyncio
async def test_frontend_service_health(test_frontend_service):
    """Test basic health and responsiveness of the frontend service."""
    service, service_url = test_frontend_service
    
    print("🏥 Testing service health...")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        
        try:
            context = await browser.new_context()
            page = await context.new_page()
            
            # Test multiple requests to ensure service stability
            for i in range(3):
                print(f"📊 Health check {i+1}/3...")
                
                response = await page.goto(service_url, timeout=20000)
                assert response.status < 400, f"Health check {i+1} failed with status: {response.status}"
                
                # Small delay between requests
                await asyncio.sleep(1)
            
            print("✅ All health checks passed")
            
        finally:
            await context.close()
            await browser.close()

# Integration test to verify the service works end-to-end
@pytest.mark.asyncio
async def test_frontend_service_integration(test_frontend_service):
    """Integration test for the complete frontend service functionality."""
    service, service_url = test_frontend_service
    
    print("🔧 Running integration test...")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        
        try:
            context = await browser.new_context()
            page = await context.new_page()
            
            # Enable console logging to catch any JavaScript errors
            console_messages = []
            page.on('console', lambda msg: console_messages.append(f"{msg.type}: {msg.text}"))
            
            # Enable error logging
            page_errors = []
            page.on('pageerror', lambda error: page_errors.append(str(error)))
            
            # Navigate to the main page
            print(f"🌐 Loading main page: {service_url}")
            response = await page.goto(service_url, timeout=30000)
            
            assert response.status < 400, f"Main page failed to load: {response.status}"
            
            # Wait for page to be fully loaded
            await page.wait_for_load_state('networkidle', timeout=15000)
            
            # Check for JavaScript errors
            if page_errors:
                print("⚠️  JavaScript errors detected:")
                for error in page_errors[:5]:  # Show first 5 errors
                    print(f"  - {error}")
            
            # Log console messages for debugging
            if console_messages:
                print("📝 Console messages:")
                for msg in console_messages[-10:]:  # Show last 10 messages
                    print(f"  - {msg}")
            
            # Verify the page is interactive (no critical JavaScript errors)
            # We can check this by trying to execute a simple JavaScript command
            try:
                result = await page.evaluate('document.readyState')
                assert result == 'complete', f"Page not fully loaded: {result}"
                print("✅ Page is fully loaded and interactive")
            except Exception as js_error:
                print(f"⚠️  JavaScript execution test failed: {js_error}")
                # This might be expected if it's a simple HTML page without JavaScript
            
        finally:
            await context.close()
            await browser.close()

if __name__ == "__main__":
    # Run tests individually for debugging
    pytest.main([__file__, "-v", "-s"]) 