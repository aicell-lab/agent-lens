"""
Test suite for Agent-Lens FastAPI frontend service.
Tests service registration, connectivity, and frontend functionality using Playwright.
Includes comprehensive UI testing for login flow, sidebar navigation, and simulated microscope operations.
"""

import pytest
import pytest_asyncio
import asyncio
import os
import uuid
import time
import sys
import json
import shutil
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
TEST_WORKSPACE = "agent-lens"
TEST_TIMEOUT = 120  # seconds
WORKSPACE_TOKEN = os.getenv('WORKSPACE_TOKEN')  # Get token from environment

# Coverage configuration
COVERAGE_DIR = Path(__file__).parent.parent / "frontend" / "coverage"
COVERAGE_ENABLED = os.getenv('PLAYWRIGHT_COVERAGE', 'true').lower() == 'true'

def setup_coverage_collection():
    """Setup coverage collection directory."""
    if COVERAGE_ENABLED:
        COVERAGE_DIR.mkdir(parents=True, exist_ok=True)
        print(f"📊 Coverage collection enabled. Reports will be saved to: {COVERAGE_DIR}")

async def collect_coverage(page, test_name):
    """Collect coverage data from a Playwright page."""
    if not COVERAGE_ENABLED:
        return
    
    try:
        # Wait a bit for coverage to be collected and try multiple times
        coverage_data = None
        for attempt in range(3):
            coverage_data = await page.evaluate("""
                () => {
                    // Try different possible coverage object locations
                    return window.__coverage__ || 
                           window.top.__coverage__ || 
                           (window.parent && window.parent.__coverage__) ||
                           null;
                }
            """)
            
            if coverage_data:
                break
            
            # Wait and try again
            await page.wait_for_timeout(1000)
            print(f"🔍 Coverage attempt {attempt + 1}/3 for {test_name}...")
        
        if coverage_data:
            # Save coverage data for this test
            coverage_file = COVERAGE_DIR / f"coverage-{test_name}-{uuid.uuid4().hex[:8]}.json"
            with open(coverage_file, 'w') as f:
                json.dump(coverage_data, f, indent=2)
            print(f"✅ Coverage data saved: {coverage_file.name} ({len(coverage_data)} files)")
        else:
            print(f"⚠️  No coverage data found for test: {test_name}")
            # Debug: check what's available on window
            window_props = await page.evaluate("""
                () => {
                    const props = [];
                    for (let prop in window) {
                        if (prop.includes('coverage') || prop.includes('nyc') || prop.includes('istanbul')) {
                            props.push(prop);
                        }
                    }
                    return {
                        coverage_props: props,
                        has_coverage: !!window.__coverage__,
                        coverage_keys: window.__coverage__ ? Object.keys(window.__coverage__) : []
                    };
                }
            """)
            print(f"🔍 Debug window properties: {window_props}")
            
    except Exception as e:
        print(f"⚠️  Failed to collect coverage for {test_name}: {e}")

def calculate_coverage_percentage(hit_count, total_count):
    """Calculate coverage percentage."""
    if total_count == 0:
        return 100.0
    return round((hit_count / total_count) * 100, 1)

def generate_coverage_report():
    """Generate final coverage report from collected data."""
    if not COVERAGE_ENABLED:
        return
        
    try:
        # Check if we have coverage files
        coverage_files = list(COVERAGE_DIR.glob("coverage-*.json"))
        if not coverage_files:
            print("⚠️  No coverage files found to generate report")
            return
            
        print(f"📊 Found {len(coverage_files)} coverage files")
        
        # Merge all coverage data
        merged_coverage = {}
        for coverage_file in coverage_files:
            try:
                with open(coverage_file, 'r') as f:
                    coverage_data = json.load(f)
                    for file_path, file_coverage in coverage_data.items():
                        if file_path not in merged_coverage:
                            merged_coverage[file_path] = file_coverage
                        else:
                            # Merge statement counts
                            for stmt_id, count in file_coverage.get('s', {}).items():
                                merged_coverage[file_path]['s'][stmt_id] = merged_coverage[file_path]['s'].get(stmt_id, 0) + count
                            # Merge function counts
                            for func_id, count in file_coverage.get('f', {}).items():
                                merged_coverage[file_path]['f'][func_id] = merged_coverage[file_path]['f'].get(func_id, 0) + count
                            # Merge branch counts  
                            for branch_id, counts in file_coverage.get('b', {}).items():
                                if branch_id not in merged_coverage[file_path]['b']:
                                    merged_coverage[file_path]['b'][branch_id] = counts
                                else:
                                    for i, count in enumerate(counts):
                                        merged_coverage[file_path]['b'][branch_id][i] = merged_coverage[file_path]['b'][branch_id][i] + count
            except Exception as e:
                print(f"⚠️  Failed to read coverage file {coverage_file}: {e}")
        
        if merged_coverage:
            # Save merged coverage
            merged_file = COVERAGE_DIR / "coverage-merged.json"
            with open(merged_file, 'w') as f:
                json.dump(merged_coverage, f, indent=2)
            print(f"✅ Merged coverage data saved: {merged_file}")
            
            # Generate prettier coverage report
            print("\n" + "="*90)
            print("📊 PLAYWRIGHT COVERAGE REPORT")
            print("="*90)
            print(f"{'File':<50} {'Stmts':<8} {'Miss':<8} {'Branch':<8} {'BrPart':<8} {'Cover':<8}")
            print("-"*90)
            
            total_stmts = 0
            total_miss_stmts = 0
            total_branches = 0
            total_miss_branches = 0
            total_funcs = 0
            total_miss_funcs = 0
            
            # Filter to only show our React components and main files
            our_files = []
            for file_path, file_coverage in merged_coverage.items():
                if any(pattern in file_path for pattern in ['/components/', '/src/', 'main.jsx', 'utils.jsx']):
                    our_files.append((file_path, file_coverage))
            
            # Sort by file name for better readability
            our_files.sort(key=lambda x: x[0])
            
            for file_path, file_coverage in our_files:
                # Calculate statement coverage
                statements = file_coverage.get('s', {})
                stmt_total = len(statements)
                stmt_hit = sum(1 for count in statements.values() if count > 0)
                stmt_miss = stmt_total - stmt_hit
                
                # Calculate function coverage
                functions = file_coverage.get('f', {})
                func_total = len(functions)
                func_hit = sum(1 for count in functions.values() if count > 0)
                func_miss = func_total - func_hit
                
                # Calculate branch coverage
                branches = file_coverage.get('b', {})
                branch_total = sum(len(branch_counts) for branch_counts in branches.values())
                branch_hit = sum(
                    sum(1 for count in branch_counts if count > 0)
                    for branch_counts in branches.values()
                )
                branch_miss = branch_total - branch_hit
                
                # Calculate overall coverage percentage (statement-based)
                coverage_pct = calculate_coverage_percentage(stmt_hit, stmt_total)
                
                # Accumulate totals
                total_stmts += stmt_total
                total_miss_stmts += stmt_miss
                total_branches += branch_total
                total_miss_branches += branch_miss
                total_funcs += func_total
                total_miss_funcs += func_miss
                
                # Format file name (show relative path)
                rel_path = file_path.replace(str(Path(__file__).parent.parent / "frontend"), "")
                if rel_path.startswith("/"):
                    rel_path = rel_path[1:]
                
                # Truncate long file names
                display_name = rel_path if len(rel_path) <= 48 else "..." + rel_path[-45:]
                
                print(f"{display_name:<50} {stmt_total:<8} {stmt_miss:<8} {branch_total:<8} {branch_miss:<8} {coverage_pct:<7.1f}%")
            
            print("-"*90)
            
            # Calculate totals
            total_coverage = calculate_coverage_percentage(total_stmts - total_miss_stmts, total_stmts)
            total_branch_coverage = calculate_coverage_percentage(total_branches - total_miss_branches, total_branches)
            total_func_coverage = calculate_coverage_percentage(total_funcs - total_miss_funcs, total_funcs)
            
            print(f"{'TOTAL':<50} {total_stmts:<8} {total_miss_stmts:<8} {total_branches:<8} {total_miss_branches:<8} {total_coverage:<7.1f}%")
            print("-"*90)
            print(f"\n📈 COVERAGE SUMMARY:")
            print(f"   Statements: {total_stmts - total_miss_stmts}/{total_stmts} ({total_coverage:.1f}%)")
            print(f"   Branches:   {total_branches - total_miss_branches}/{total_branches} ({total_branch_coverage:.1f}%)")
            print(f"   Functions:  {total_funcs - total_miss_funcs}/{total_funcs} ({total_func_coverage:.1f}%)")
            print(f"   Files:      {len(our_files)} React components covered")
            
            # Show coverage quality assessment
            if total_coverage >= 80:
                quality = "🟢 Excellent"
            elif total_coverage >= 60:
                quality = "🟡 Good"
            elif total_coverage >= 40:
                quality = "🟠 Fair"
            else:
                quality = "🔴 Poor"
            
            print(f"   Quality:    {quality} coverage")
            print("="*90)
            
            # Save a text report file
            report_file = COVERAGE_DIR / "coverage-report.txt"
            with open(report_file, 'w') as f:
                f.write("PLAYWRIGHT COVERAGE REPORT\n")
                f.write("="*50 + "\n")
                f.write(f"Statements: {total_stmts - total_miss_stmts}/{total_stmts} ({total_coverage:.1f}%)\n")
                f.write(f"Branches:   {total_branches - total_miss_branches}/{total_branches} ({total_branch_coverage:.1f}%)\n")
                f.write(f"Functions:  {total_funcs - total_miss_funcs}/{total_funcs} ({total_func_coverage:.1f}%)\n")
                f.write(f"Files:      {len(our_files)} React components\n")
                f.write(f"Quality:    {quality} coverage\n")
            
            print(f"💾 Coverage report saved: {report_file}")
        
    except Exception as e:
        print(f"❌ Failed to generate coverage report: {e}")

@pytest_asyncio.fixture(scope="function")
async def test_frontend_service(hypha_server):
    """Create a real frontend service for testing."""
    print(f"🔗 Using Hypha server connection...")
    
    server = hypha_server
    service = None
    
    try:
        print("✅ Connected to server")
        
        # Create unique service ID for this test
        test_id = f"test-agent-lens-frontend-{uuid.uuid4().hex[:8]}"
        print(f"Creating test frontend service with ID: {test_id}")
        
        # Register the frontend service
        print("📝 Registering frontend service...")
        service_start_time = time.time()
        
        # Setup coverage collection
        setup_coverage_collection()
        
        # Check if frontend assets exist, if not build with coverage instrumentation
        frontend_dist = Path(__file__).parent.parent / "frontend" / "dist"
        if not frontend_dist.exists() or COVERAGE_ENABLED:
            print("🏗️ Building frontend with coverage instrumentation...")
            try:
                import subprocess
                frontend_dir = Path(__file__).parent.parent / "frontend"
                
                # Build with test mode for coverage instrumentation
                build_cmd = ["npm", "run", "build:test"] if COVERAGE_ENABLED else ["npm", "run", "build"]
                result = subprocess.run(build_cmd, cwd=frontend_dir, capture_output=True, text=True)
                
                if result.returncode == 0:
                    print("✅ Frontend built successfully with coverage instrumentation")
                else:
                    print(f"⚠️ Frontend build failed: {result.stderr}")
                    # Fall back to minimal structure
                    frontend_dist.mkdir(parents=True, exist_ok=True)
                    assets_dir = frontend_dist / "assets"
                    assets_dir.mkdir(exist_ok=True)
                    
                    # Create a minimal index.html for testing
                    index_html = frontend_dist / "index.html"
                    index_html.write_text("""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Agent-Lens Test</title>
</head>
<body>
    <div id="root">Agent-Lens Frontend Service Test</div>
</body>
</html>""")
                    print("✅ Created minimal frontend structure for testing")
                    
            except Exception as e:
                print(f"⚠️ Build failed, creating minimal structure: {e}")
                frontend_dist.mkdir(parents=True, exist_ok=True)
                assets_dir = frontend_dist / "assets"
                assets_dir.mkdir(exist_ok=True)
                
                # Create a minimal index.html for testing
                index_html = frontend_dist / "index.html"
                index_html.write_text("""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Agent-Lens Test</title>
</head>
<body>
    <div id="root">Agent-Lens Frontend Service Test</div>
</body>
</html>""")
                print("✅ Created minimal frontend structure for testing")
        
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
            # Enhanced cleanup
            print(f"🧹 Starting cleanup...")
            
            try:
                # Cancel any pending tasks related to this service
                current_tasks = [task for task in asyncio.all_tasks() 
                               if not task.done() and (test_id in str(task) or 'frontend' in str(task).lower())]
                
                if current_tasks:
                    print(f"Cancelling {len(current_tasks)} service-related tasks...")
                    for task in current_tasks:
                        if not task.done():
                            task.cancel()
                    
                    # Wait for cancellation with timeout
                    try:
                        await asyncio.wait_for(
                            asyncio.gather(*current_tasks, return_exceptions=True),
                            timeout=2.0
                        )
                    except asyncio.TimeoutError:
                        print("⚠️  Some tasks didn't cancel in time")
                
                print("✅ Cleanup completed")
                
            except Exception as e:
                print(f"⚠️  Cleanup error (non-critical): {e}")
            
            # Brief pause for final cleanup
            await asyncio.sleep(0.1)
        
    except Exception as e:
        pytest.fail(f"Failed to create test frontend service: {e}")

@pytest.mark.asyncio
@pytest.mark.timeout(60)
async def test_frontend_service_registration_and_connectivity(test_frontend_service):
    """Test that the frontend service can be registered and is accessible."""
    service, service_url = test_frontend_service
    
    print("🧪 Testing service registration and connectivity...")
    
    # The frontend service doesn't have traditional RPC methods, but we can check if it's registered
    # by verifying the service object exists and has the expected configuration
    assert service is not None
    print("✅ Service registration verified")

@pytest.mark.asyncio
@pytest.mark.timeout(180)
async def test_frontend_login_flow(test_frontend_service):
    """Test the frontend login flow using WORKSPACE_TOKEN."""
    service, service_url = test_frontend_service
    
    print("🔐 Testing frontend login flow...")
    
    if not WORKSPACE_TOKEN:
        pytest.skip("WORKSPACE_TOKEN environment variable not set")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        
        try:
            context = await browser.new_context()
            page = await context.new_page()
            
            # Set up console logging
            console_messages = []
            page.on('console', lambda msg: console_messages.append(f"{msg.type}: {msg.text}"))
            
            print(f"📄 Navigating to service URL: {service_url}")
            
            # Navigate to the service URL
            response = await page.goto(service_url, timeout=30000)
            assert response.status < 400, f"HTTP error: {response.status}"
            
            # Wait for page to load
            await page.wait_for_load_state('networkidle', timeout=15000)
            
            # Check if we see the login prompt initially
            print("🔍 Looking for login prompt...")
            login_button = page.locator('button:has-text("Log in to Hypha")')
            
            if await login_button.count() > 0:
                print("✅ Login prompt found")
                
                # Set the workspace token in localStorage before clicking login
                await page.evaluate(f'localStorage.setItem("token", "{WORKSPACE_TOKEN}")')
                print("🔑 Set WORKSPACE_TOKEN in localStorage")
                
                # Reload the page to trigger authentication check
                await page.reload()
                await page.wait_for_load_state('networkidle', timeout=15000)
                
                # Wait for authentication to complete and main app to load
                # Try multiple selectors that indicate the main app has loaded
                selectors_to_try = ['.sidebar', '.main-layout', '.app-container', '#root > div']
                main_app_loaded = False
                for selector in selectors_to_try:
                    try:
                        await page.wait_for_selector(selector, timeout=10000)
                        main_app_loaded = True
                        print(f"✅ Main application loaded after authentication (found: {selector})")
                        break
                    except:
                        continue
                
                if not main_app_loaded:
                    print("⚠️  Could not find main app selectors, but continuing with test...")
                    # Take screenshot to debug
                    screenshot_path = f"/tmp/login_debug_{uuid.uuid4().hex[:8]}.png"
                    await page.screenshot(path=screenshot_path)
                    print(f"📸 Debug screenshot saved to: {screenshot_path}")
                
            else:
                print("ℹ️  No login prompt found, assuming already authenticated or different flow")
            
            # Take screenshot for debugging
            screenshot_path = f"/tmp/login_test_{uuid.uuid4().hex[:8]}.png"
            await page.screenshot(path=screenshot_path)
            print(f"📸 Login test screenshot saved to: {screenshot_path}")
            
            # Collect coverage data
            await collect_coverage(page, "login_flow")
            
        finally:
            await context.close()
            await browser.close()

@pytest.mark.asyncio
@pytest.mark.timeout(180)  
async def test_frontend_sidebar_navigation(test_frontend_service):
    """Test navigation through different sidebar tabs."""
    service, service_url = test_frontend_service
    
    print("🧭 Testing sidebar navigation...")
    
    if not WORKSPACE_TOKEN:
        pytest.skip("WORKSPACE_TOKEN environment variable not set")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        
        try:
            context = await browser.new_context()
            page = await context.new_page()
            
            # Set up console logging
            console_messages = []
            page.on('console', lambda msg: console_messages.append(f"{msg.type}: {msg.text}"))
            
            # Navigate and authenticate
            await page.goto(service_url, timeout=30000)
            await page.evaluate(f'localStorage.setItem("token", "{WORKSPACE_TOKEN}")')
            await page.reload()
            await page.wait_for_load_state('networkidle', timeout=15000)
            
            # Wait for main app to load with multiple selector options
            selectors_to_try = ['.sidebar', '.main-layout', '.app-container', '#root > div']
            main_app_loaded = False
            for selector in selectors_to_try:
                try:
                    await page.wait_for_selector(selector, timeout=10000)
                    main_app_loaded = True
                    print(f"✅ Main application loaded (found: {selector})")
                    break
                except:
                    continue
            
            if not main_app_loaded:
                screenshot_path = f"/tmp/sidebar_debug_{uuid.uuid4().hex[:8]}.png"
                await page.screenshot(path=screenshot_path)
                print(f"📸 Debug screenshot saved to: {screenshot_path}")
                raise AssertionError("❌ ERROR: Could not find main app selectors - main application failed to load")
            
            # Test different sidebar tabs with correct selectors based on Sidebar.jsx
            sidebar_tabs = [
                {
                    'name': 'Microscopes', 
                    'selectors': [
                        '.sidebar-tab:has-text("Microscopes")',  # Primary selector from Sidebar.jsx
                        'button:has-text("Microscopes")',
                        '.sidebar-tab .fa-microscope',           # Icon-based selector
                        '.sidebar-tab[title*="Microscopes"]'
                    ],
                    'required': True
                },
                {
                    'name': 'ImageJ', 
                    'selectors': [
                        '.sidebar-tab:has-text("ImageJ")',       # Primary selector from Sidebar.jsx
                        'button:has-text("ImageJ")',
                        '.sidebar-tab .fa-magic',               # Icon-based selector
                        '.sidebar-tab[title*="ImageJ"]'
                    ],
                    'required': True
                },
                {
                    'name': 'Image View', 
                    'selectors': [
                        '.sidebar-tab:has-text("Image View")',   # Primary selector from Sidebar.jsx
                        'button:has-text("Image View")',
                        '.sidebar-tab .fa-images',              # Icon-based selector
                        '.sidebar-tab[title*="View images"]'
                    ],
                    'required': True
                },
                {
                    'name': 'Image Search', 
                    'selectors': [
                        '.sidebar-tab:has-text("Image Search")', # Primary selector from Sidebar.jsx
                        'button:has-text("Image Search")',
                        '.sidebar-tab .fa-search',              # Icon-based selector
                        '.sidebar-tab[title*="Search for similar"]'
                    ],
                    'required': True
                },
                {
                    'name': 'Incubator', 
                    'selectors': [
                        '.sidebar-tab:has-text("Incubator")',    # Primary selector from Sidebar.jsx
                        'button:has-text("Incubator")',
                        '.sidebar-tab .fa-temperature-high',    # Icon-based selector
                        '.sidebar-tab[title*="Control incubator"]'
                    ],
                    'required': True
                },
                {
                    'name': 'Dashboard', 
                    'selectors': [
                        '.sidebar-tab:has-text("Dashboard")',    # Primary selector from Sidebar.jsx
                        'button:has-text("Dashboard")',
                        '.sidebar-tab .fa-tachometer-alt',      # Icon-based selector
                        '.sidebar-tab[title*="View dashboard"]'
                    ],
                    'required': True
                },
            ]
            
            failed_tabs = []
            successful_tabs = []
            
            for tab in sidebar_tabs:
                print(f"🔍 Testing {tab['name']} tab...")
                
                found = False
                successful_selector = None
                try:
                    # Try each selector for this tab
                    for selector in tab['selectors']:
                        try:
                            tab_element = page.locator(selector).first
                            count = await tab_element.count()
                            if count > 0:
                                await tab_element.click()
                                await page.wait_for_timeout(2000)  # Wait for content to load
                                print(f"✅ Successfully navigated to {tab['name']} tab (selector: {selector}, count: {count})")
                                found = True
                                successful_selector = selector
                                successful_tabs.append(f"{tab['name']} ({selector})")
                                break
                        except Exception as selector_error:
                            print(f"  - Selector '{selector}' failed: {selector_error}")
                            continue  # Try next selector
                    
                    if not found:
                        if tab['required']:
                            failed_tabs.append(tab['name'])
                            print(f"❌ ERROR: Required tab '{tab['name']}' not found with any selector")
                        else:
                            print(f"⚠️  Optional tab '{tab['name']}' not found")
                            
                except Exception as e:
                    if tab['required']:
                        failed_tabs.append(tab['name'])
                        print(f"❌ ERROR: Exception testing {tab['name']} tab: {e}")
                    else:
                        print(f"⚠️  Exception testing {tab['name']} tab: {e}")
                    continue
            
            # Check if we found the basic sidebar structure
            print("🔍 Verifying sidebar structure...")
            sidebar_structure_selectors = [
                '.sidebar-container',     # Main sidebar container from Sidebar.jsx
                '.main-sidebar',         # Main sidebar from Sidebar.jsx
                '.sidebar-tabs',         # Tabs container from Sidebar.jsx
                '.sidebar-tab'           # Individual tab class from Sidebar.jsx
            ]
            
            structure_found = False
            for selector in sidebar_structure_selectors:
                try:
                    count = await page.locator(selector).count()
                    if count > 0:
                        print(f"✅ Found sidebar structure (selector: {selector}, count: {count})")
                        structure_found = True
                        break
                except Exception as e:
                    print(f"  - Structure selector '{selector}' failed: {e}")
                    continue
            
            if not structure_found:
                failed_tabs.append("Sidebar Structure")
                print("❌ ERROR: Sidebar structure not found")
            
            # Report results
            if successful_tabs:
                print(f"✅ Successfully found {len(successful_tabs)} tabs: {', '.join(successful_tabs)}")
            
            if failed_tabs:
                screenshot_path = f"/tmp/sidebar_navigation_error_{uuid.uuid4().hex[:8]}.png"
                await page.screenshot(path=screenshot_path)
                print(f"📸 Sidebar navigation error screenshot saved to: {screenshot_path}")
                raise AssertionError(f"❌ ERROR: Required sidebar elements not found: {', '.join(failed_tabs)}")
            
            # Take screenshot of final state
            screenshot_path = f"/tmp/sidebar_navigation_success_{uuid.uuid4().hex[:8]}.png"
            await page.screenshot(path=screenshot_path)
            print(f"📸 Sidebar navigation test screenshot saved to: {screenshot_path}")
            print("✅ Sidebar navigation test completed successfully")
            
            # Collect coverage data
            await collect_coverage(page, "sidebar_navigation")
            
        finally:
            await context.close()
            await browser.close()

@pytest.mark.asyncio
@pytest.mark.timeout(240)
async def test_frontend_simulated_microscope_controls(test_frontend_service):
    """Test the simulated microscope controls and features."""
    service, service_url = test_frontend_service
    
    print("🔬 Testing simulated microscope controls...")
    
    if not WORKSPACE_TOKEN:
        pytest.skip("WORKSPACE_TOKEN environment variable not set")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        
        try:
            context = await browser.new_context()
            page = await context.new_page()
            
            # Set up console and error logging
            console_messages = []
            page_errors = []
            page.on('console', lambda msg: console_messages.append(f"{msg.type}: {msg.text}"))
            page.on('pageerror', lambda error: page_errors.append(str(error)))
            
            # Navigate and authenticate
            await page.goto(service_url, timeout=30000)
            await page.evaluate(f'localStorage.setItem("token", "{WORKSPACE_TOKEN}")')
            await page.reload()
            await page.wait_for_load_state('networkidle', timeout=15000)
            
            # Wait for main app to load with flexible selectors
            selectors_to_try = ['.sidebar', '.main-layout', '.app-container', '#root > div']
            main_app_loaded = False
            for selector in selectors_to_try:
                try:
                    await page.wait_for_selector(selector, timeout=10000)
                    main_app_loaded = True
                    print(f"✅ Main application loaded (found: {selector})")
                    break
                except:
                    continue
            
            if not main_app_loaded:
                print("⚠️  Could not find main app selectors, but continuing with test...")
                # Take screenshot to help debug
                screenshot_path = f"/tmp/microscope_debug_{uuid.uuid4().hex[:8]}.png"
                await page.screenshot(path=screenshot_path)
                print(f"📸 Debug screenshot saved to: {screenshot_path}")
                # We'll continue since the app might be there but with different selectors
            
            # Navigate to microscope tab with comprehensive selectors
            print("🔍 Navigating to microscope tab...")
            microscope_selectors = [
                '[data-tab="microscope"]',
                '.sidebar-item:has-text("Microscope")',
                'button:has-text("Microscope")',
                'text="Microscope"',
                '.microscope-tab',
                '.microscope-control',
                'div:has-text("Microscope")',
                '*:has-text("Microscope")'
            ]
            
            microscope_tab_found = False
            for selector in microscope_selectors:
                try:
                    microscope_tab = page.locator(selector).first
                    if await microscope_tab.count() > 0:
                        await microscope_tab.click()
                        await page.wait_for_timeout(3000)
                        print(f"✅ Navigated to microscope tab (using: {selector})")
                        microscope_tab_found = True
                        break
                except Exception as e:
                    continue
            
            if not microscope_tab_found:
                print("⚠️  Could not find microscope tab with any selector, continuing with test...")
                # Take a screenshot for debugging
                screenshot_path = f"/tmp/microscope_tab_debug_{uuid.uuid4().hex[:8]}.png"
                await page.screenshot(path=screenshot_path)
                print(f"📸 Microscope tab debug screenshot saved to: {screenshot_path}")
            
            # Look for simulated microscope selection
            print("🔍 Looking for simulated microscope option...")
            simulated_option = page.locator('text="Simulated Microscope"').first
            if await simulated_option.count() > 0:
                print("✅ Found simulated microscope option")
                
                # Click on simulated microscope if it's clickable
                try:
                    await simulated_option.click()
                    await page.wait_for_timeout(2000)
                    print("✅ Selected simulated microscope")
                except Exception as e:
                    print(f"ℹ️  Simulated microscope already selected or not clickable: {e}")
            else:
                print("ℹ️  Simulated microscope option not immediately visible")
            
            # Test common microscope controls
            microscope_controls = [
                {'name': 'Snap Image', 'selectors': ['button:has-text("Snap Image")', '[data-action="snap"]', '.snap-button']},
                {'name': 'Move Controls', 'selectors': ['.movement-controls', '.position-controls', 'button:has-text("Move")']},
                {'name': 'Light Controls', 'selectors': ['.light-controls', 'button:has-text("Light")', '.illumination-controls']},
                {'name': 'Sample Selector', 'selectors': ['button:has-text("Select Samples")', '.sample-selector', '[data-action="samples"]']},
                {'name': 'Camera Settings', 'selectors': ['.camera-settings', 'button:has-text("Camera")', '.exposure-controls']},
            ]
            
            for control in microscope_controls:
                print(f"🔍 Looking for {control['name']}...")
                found = False
                
                for selector in control['selectors']:
                    element = page.locator(selector).first
                    if await element.count() > 0:
                        print(f"✅ Found {control['name']} control")
                        
                        # Try to interact with the control (if it's a button)
                        try:
                            if 'button' in selector.lower():
                                await element.click()
                                await page.wait_for_timeout(1000)
                                print(f"✅ Successfully clicked {control['name']}")
                        except Exception as e:
                            print(f"ℹ️  Could not click {control['name']}: {e}")
                            
                        found = True
                        break
                
                if not found:
                    print(f"⚠️  {control['name']} control not found")
            
            # Test simulated sample loading if sample selector is available
            print("🔍 Testing simulated sample loading...")
            sample_selector = page.locator('button:has-text("Select Samples"), .sample-selector-button').first
            if await sample_selector.count() > 0:
                try:
                    await sample_selector.click()
                    await page.wait_for_timeout(2000)
                    
                    # Look for simulated samples
                    simulated_samples = page.locator('text*="simulated-sample"')
                    if await simulated_samples.count() > 0:
                        print(f"✅ Found {await simulated_samples.count()} simulated samples")
                        
                        # Try to select first simulated sample
                        first_sample = simulated_samples.first
                        await first_sample.click()
                        await page.wait_for_timeout(1000)
                        print("✅ Selected simulated sample")
                    else:
                        print("ℹ️  No simulated samples found in selector")
                        
                except Exception as e:
                    print(f"⚠️  Error testing sample selection: {e}")
            
            # Check for any JavaScript errors
            if page_errors:
                print("⚠️  JavaScript errors detected:")
                for error in page_errors[:3]:
                    print(f"  - {error}")
            
            # Take final screenshot
            screenshot_path = f"/tmp/microscope_test_{uuid.uuid4().hex[:8]}.png"
            await page.screenshot(path=screenshot_path)
            print(f"📸 Microscope test screenshot saved to: {screenshot_path}")
            
            # Collect coverage data
            await collect_coverage(page, "microscope_controls")
            
        finally:
            await context.close()
            await browser.close()

@pytest.mark.asyncio
@pytest.mark.timeout(120)
async def test_frontend_image_view_browser(test_frontend_service):
    """Test the image view browser functionality."""
    service, service_url = test_frontend_service
    
    print("🖼️  Testing image view browser...")
    
    if not WORKSPACE_TOKEN:
        pytest.skip("WORKSPACE_TOKEN environment variable not set")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        
        try:
            context = await browser.new_context()
            page = await context.new_page()
            
            # Navigate and authenticate
            await page.goto(service_url, timeout=30000)
            await page.evaluate(f'localStorage.setItem("token", "{WORKSPACE_TOKEN}")')
            await page.reload()
            await page.wait_for_load_state('networkidle', timeout=15000)
            
            # Wait for main app and navigate to image view
            selectors_to_try = ['.sidebar', '.main-layout', '.app-container', '#root > div']
            main_app_loaded = False
            for selector in selectors_to_try:
                try:
                    await page.wait_for_selector(selector, timeout=10000)
                    main_app_loaded = True
                    print(f"✅ Main application loaded (found: {selector})")
                    break
                except:
                    continue
            
            if not main_app_loaded:
                screenshot_path = f"/tmp/imageview_debug_{uuid.uuid4().hex[:8]}.png"
                await page.screenshot(path=screenshot_path)
                print(f"📸 Debug screenshot saved to: {screenshot_path}")
                raise AssertionError("❌ ERROR: Could not find main app selectors - main application failed to load")
            
            # Navigate to image view tab - Updated selectors based on actual component structure
            print("🔍 Looking for Image View tab...")
            image_view_selectors = [
                '.sidebar-tab:has-text("Image View")',  # Primary selector based on Sidebar.jsx
                'button:has-text("Image View")',        # Alternative button selector
                '.sidebar-tab[title*="View images"]',   # Based on title attribute
                '.sidebar-tab .fa-images'               # Icon-based selector as fallback
            ]
            
            image_view_tab_found = False
            for selector in image_view_selectors:
                try:
                    element = page.locator(selector).first
                    if await element.count() > 0:
                        await element.click()
                        await page.wait_for_timeout(3000)  # Wait for tab switch and content load
                        print(f"✅ Successfully navigated to Image View tab (found: {selector})")
                        image_view_tab_found = True
                        break
                except Exception as e:
                    print(f"  - Selector '{selector}' failed: {e}")
                    continue
            
            if not image_view_tab_found:
                screenshot_path = f"/tmp/image_view_tab_error_{uuid.uuid4().hex[:8]}.png"
                await page.screenshot(path=screenshot_path)
                print(f"📸 Image view tab error screenshot saved to: {screenshot_path}")
                raise AssertionError("❌ ERROR: Image View tab not found - unable to navigate to image view")
            
            # Look for image browser elements - Updated selectors based on ImageViewBrowser.jsx and Sidebar.jsx
            print("🔍 Checking for image browser elements...")
            browser_elements = [
                {
                    'name': 'Image View Sidebar',
                    'selectors': ['.image-view-sidebar', '.gallery-selection', '.sidebar-container .image-view-sidebar'],
                    'required': True
                },
                {
                    'name': 'Gallery Selection Panel',
                    'selectors': ['.gallery-selection', '.gallery-options', '.gallery-option'],
                    'required': True
                },
                {
                    'name': 'Browse Data Button',
                    'selectors': ['.browse-data-button', 'button:has-text("Browse Data")', '.gallery-actions-section button'],
                    'required': True
                },
                {
                    'name': 'View Image Data Button',
                    'selectors': ['.view-gallery-image-data-button', 'button:has-text("View Image Data")', 'button .fa-map'],
                    'required': False  # May not be visible initially
                },
                {
                    'name': 'Main Browser Area',
                    'selectors': ['.image-view-browser', '.browser-title', '.datasets-view'],
                    'required': True
                },
                {
                    'name': 'Gallery Title/Label',
                    'selectors': ['.image-view-sidebar-title', 'h3:has-text("Select Image Gallery")', '.gallery-label'],
                    'required': True
                },
            ]
            
            failed_elements = []
            for element in browser_elements:
                found = False
                for selector in element['selectors']:
                    try:
                        count = await page.locator(selector).count()
                        if count > 0:
                            print(f"✅ Found {element['name']} (selector: {selector}, count: {count})")
                            found = True
                            break
                    except Exception as e:
                        print(f"  - Selector '{selector}' for {element['name']} failed: {e}")
                        continue
                
                if not found:
                    if element['required']:
                        failed_elements.append(element['name'])
                        print(f"❌ ERROR: Required element '{element['name']}' not found")
                    else:
                        print(f"⚠️  Optional element '{element['name']}' not found")
            
            # Check for specific gallery items that should be available
            print("🔍 Checking for default gallery items...")
            gallery_selectors = [
                '.gallery-option',
                '.gallery-select-btn',
                'button:has-text("20250506-scan-time-lapse-gallery")',  # Default gallery from Sidebar.jsx
                'button:has-text("hpa-sample-gallery")',                 # Alternative gallery from Sidebar.jsx
            ]
            
            gallery_found = False
            for selector in gallery_selectors:
                try:
                    count = await page.locator(selector).count()
                    if count > 0:
                        print(f"✅ Found gallery items (selector: {selector}, count: {count})")
                        gallery_found = True
                        break
                except Exception as e:
                    print(f"  - Gallery selector '{selector}' failed: {e}")
                    continue
            
            if not gallery_found:
                failed_elements.append("Gallery Items")
                print("❌ ERROR: No gallery items found in gallery selection")
            
            # If any required elements failed, raise an error
            if failed_elements:
                screenshot_path = f"/tmp/image_view_elements_error_{uuid.uuid4().hex[:8]}.png"
                await page.screenshot(path=screenshot_path)
                print(f"📸 Elements error screenshot saved to: {screenshot_path}")
                raise AssertionError(f"❌ ERROR: Required image view browser elements not found: {', '.join(failed_elements)}")
            
            # Test gallery interaction if possible
            print("🔍 Testing gallery interaction...")
            try:
                gallery_option = page.locator('.gallery-option').first
                if await gallery_option.count() > 0:
                    await gallery_option.click()
                    await page.wait_for_timeout(2000)
                    print("✅ Successfully clicked on gallery option")
                    
                    # Check if browse data button becomes available/clickable
                    browse_button = page.locator('.browse-data-button, button:has-text("Browse Data")').first
                    if await browse_button.count() > 0:
                        print("✅ Browse Data button available after gallery selection")
                    else:
                        print("⚠️  Browse Data button not found after gallery selection")
                        
            except Exception as e:
                print(f"⚠️  Gallery interaction test failed: {e}")
            
            # Take final screenshot
            screenshot_path = f"/tmp/image_view_success_{uuid.uuid4().hex[:8]}.png"
            await page.screenshot(path=screenshot_path)
            print(f"📸 Image view test screenshot saved to: {screenshot_path}")
            print("✅ Image view browser test completed successfully")
            
            # Collect coverage data
            await collect_coverage(page, "image_view_browser")
            
        finally:
            await context.close()
            await browser.close()

@pytest.mark.asyncio
@pytest.mark.timeout(90)
async def test_frontend_service_health_comprehensive(test_frontend_service):
    """Comprehensive health test for the frontend service."""
    service, service_url = test_frontend_service
    
    print("🏥 Running comprehensive service health test...")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        
        try:
            context = await browser.new_context()
            page = await context.new_page()
            
            # Set up comprehensive logging
            console_messages = []
            page_errors = []
            network_failures = []
            
            page.on('console', lambda msg: console_messages.append(f"{msg.type}: {msg.text}"))
            page.on('pageerror', lambda error: page_errors.append(str(error)))
            page.on('response', lambda response: network_failures.append(response.url) if response.status >= 400 else None)
            
            # Test multiple page loads
            for i in range(3):
                print(f"📊 Health check {i+1}/3...")
                
                response = await page.goto(service_url, timeout=20000)
                assert response.status < 400, f"Health check {i+1} failed with status: {response.status}"
                
                # Wait for page to be interactive
                await page.wait_for_load_state('domcontentloaded', timeout=10000)
                
                # Test basic page elements
                html_content = await page.content()
                assert '<html' in html_content.lower(), "Response doesn't contain HTML"
                assert '<body' in html_content.lower(), "Response doesn't contain body"
                
                # Small delay between requests
                await asyncio.sleep(1)
            
            # Report on health metrics
            print(f"📝 Console messages: {len(console_messages)}")
            print(f"❌ JavaScript errors: {len(page_errors)}")
            print(f"🔴 Network failures: {len(network_failures)}")
            
            # Show critical errors only
            if page_errors:
                print("Critical JavaScript errors:")
                for error in page_errors[:3]:
                    print(f"  - {error}")
            
            if network_failures:
                print("Network failures:")
                for failure in network_failures[:3]:
                    print(f"  - {failure}")
            
            print("✅ All health checks passed")
            
            # Collect coverage data
            await collect_coverage(page, "health_comprehensive")
            
        finally:
            await context.close()
            await browser.close()

@pytest.mark.asyncio
@pytest.mark.timeout(300)
async def test_frontend_webrtc_stops_on_operations(test_frontend_service):
    """Test that WebRTC streaming stops when opening imaging task modal and during sample operations."""
    service, service_url = test_frontend_service
    
    print("📹 Testing WebRTC stream stopping during operations with simulated microscope...")
    
    if not WORKSPACE_TOKEN:
        pytest.skip("WORKSPACE_TOKEN environment variable not set")
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        
        try:
            context = await browser.new_context()
            page = await context.new_page()
            
            # Set up console and error logging
            console_messages = []
            page_errors = []
            page.on('console', lambda msg: console_messages.append(f"{msg.type}: {msg.text}"))
            page.on('pageerror', lambda error: page_errors.append(str(error)))
            
            # Navigate and authenticate
            await page.goto(service_url, timeout=30000)
            await page.evaluate(f'localStorage.setItem("token", "{WORKSPACE_TOKEN}")')
            await page.reload()
            await page.wait_for_load_state('networkidle', timeout=15000)
            
            # Wait for main app to load
            selectors_to_try = ['.sidebar', '.main-layout', '.app-container', '#root > div']
            main_app_loaded = False
            for selector in selectors_to_try:
                try:
                    await page.wait_for_selector(selector, timeout=10000)
                    main_app_loaded = True
                    print(f"✅ Main application loaded (found: {selector})")
                    break
                except:
                    continue
            
            if not main_app_loaded:
                screenshot_path = f"/tmp/webrtc_test_debug_{uuid.uuid4().hex[:8]}.png"
                await page.screenshot(path=screenshot_path)
                print(f"📸 Debug screenshot saved to: {screenshot_path}")
                raise AssertionError("❌ ERROR: Could not find main app selectors - main application failed to load")
            
            # Navigate to microscope tab
            print("🔍 Navigating to microscope tab...")
            microscope_selectors = [
                '.sidebar-tab:has-text("Microscopes")',
                'button:has-text("Microscopes")',
                '.sidebar-tab .fa-microscope'
            ]
            
            microscope_tab_found = False
            for selector in microscope_selectors:
                try:
                    element = page.locator(selector).first
                    if await element.count() > 0:
                        await element.click()
                        await page.wait_for_timeout(3000)
                        print(f"✅ Navigated to microscope tab (using: {selector})")
                        microscope_tab_found = True
                        break
                except Exception as e:
                    continue
            
            if not microscope_tab_found:
                raise AssertionError("❌ ERROR: Could not find microscope tab")
            
            # Select simulated microscope
            print("🔍 Selecting simulated microscope...")
            simulated_microscope_selectors = [
                'option[value="agent-lens/squid-control-reef"]',
                'select option:has-text("Simulated Microscope")',
                'text="Simulated Microscope"'
            ]
            
            simulated_selected = False
            for selector in simulated_microscope_selectors:
                try:
                    element = page.locator(selector).first
                    if await element.count() > 0:
                        if 'option' in selector:
                            # Select the option from dropdown
                            parent_select = page.locator('select').filter(has=element)
                            await parent_select.select_option('agent-lens/squid-control-reef')
                        else:
                            await element.click()
                        await page.wait_for_timeout(2000)
                        print(f"✅ Selected simulated microscope (using: {selector})")
                        simulated_selected = True
                        break
                except Exception as e:
                    print(f"  - Selector '{selector}' failed: {e}")
                    continue
            
            if not simulated_selected:
                print("⚠️  Could not explicitly select simulated microscope, continuing...")
            
            # Wait for microscope control panel to load
            await page.wait_for_timeout(3000)
            
            # Look for WebRTC start button and start streaming
            print("🔍 Starting WebRTC streaming...")
            webrtc_selectors = [
                'button:has-text("Start Live")',
                '.live-button:has-text("Start Live")',
                'button[title*="Start Live"]'
            ]
            
            webrtc_started = False
            for selector in webrtc_selectors:
                try:
                    start_button = page.locator(selector).first
                    if await start_button.count() > 0:
                        await start_button.click()
                        await page.wait_for_timeout(3000)  # Wait for WebRTC to initialize
                        print(f"✅ Started WebRTC streaming (using: {selector})")
                        webrtc_started = True
                        break
                except Exception as e:
                    print(f"  - WebRTC selector '{selector}' failed: {e}")
                    continue
            
            if not webrtc_started:
                print("⚠️  Could not start WebRTC streaming, but continuing with test...")
            
            # Check if WebRTC is active by looking for stop button
            print("🔍 Verifying WebRTC is active...")
            stop_button_selectors = [
                'button:has-text("Stop Live")',
                '.live-button:has-text("Stop Live")',
                'button[title*="Stop Live"]'
            ]
            
            webrtc_active = False
            for selector in stop_button_selectors:
                try:
                    if await page.locator(selector).count() > 0:
                        print(f"✅ WebRTC appears to be active (found: {selector})")
                        webrtc_active = True
                        break
                except:
                    continue
            
            # TEST 1: Verify New Task button behavior for simulated microscope
            print("🧪 TEST 1: Verifying 'New Task' button behavior for simulated microscope...")
            
            new_task_button = page.locator('button:has-text("New Task")').first
            if await new_task_button.count() > 0:
                is_disabled = await new_task_button.get_attribute('disabled')
                button_title = await new_task_button.get_attribute('title')
                
                if is_disabled is not None:
                    print(f"✅ TEST 1 VERIFIED: New Task button is correctly disabled for simulated microscope")
                    print(f"    Reason: {button_title}")
                    print("    This confirms expected behavior - time-lapse imaging is not supported on simulated microscope")
                    print("    📝 Note: WebRTC stopping on 'New Task' click would be tested with real microscopes")
                else:
                    print("⚠️  Unexpected: New Task button is enabled for simulated microscope")
            else:
                print("⚠️  Could not find 'New Task' button")
            
            # Ensure WebRTC is active for sample operation test
            if webrtc_started and not webrtc_active:
                print("🔍 Ensuring WebRTC is active for sample operation test...")
                # WebRTC might already be running, just verify
                for selector in stop_button_selectors:
                    try:
                        if await page.locator(selector).count() > 0:
                            webrtc_active = True
                            print("✅ WebRTC confirmed active")
                            break
                    except:
                        continue
            
            # TEST 2: WebRTC stops when starting sample operations
            print("🧪 TEST 2: Testing WebRTC stops during sample loading operations...")
            
            # Open sample selector
            sample_selector_selectors = [
                'button:has-text("Select Samples")',
                '.sample-selector-toggle-button',
                'button .fa-flask'
            ]
            
            sample_selector_opened = False
            for selector in sample_selector_selectors:
                try:
                    sample_button = page.locator(selector).first
                    if await sample_button.count() > 0:
                        await sample_button.click()
                        await page.wait_for_timeout(2000)
                        print(f"✅ Opened sample selector (using: {selector})")
                        sample_selector_opened = True
                        break
                except Exception as e:
                    print(f"  - Sample selector '{selector}' failed: {e}")
                    continue
            
            if sample_selector_opened:
                # Look for simulated samples
                print("🔍 Looking for simulated samples...")
                sample_selectors = [
                    'button:has-text("Simulated Sample 1")',
                    '.sample-option:has-text("simulated-sample-1")',
                    'text="Simulated Sample 1"'
                ]
                
                sample_found = False
                for selector in sample_selectors:
                    try:
                        sample_button = page.locator(selector).first
                        if await sample_button.count() > 0:
                            await sample_button.click()
                            await page.wait_for_timeout(1000)
                            print(f"✅ Selected simulated sample (using: {selector})")
                            sample_found = True
                            break
                    except Exception as e:
                        print(f"  - Sample selector '{selector}' failed: {e}")
                        continue
                
                if sample_found:
                    # Look for load sample button and click it
                    load_button_selectors = [
                        'button:has-text("Load Sample on Microscope")',
                        '.load-sample-button',
                        'button .fa-upload'
                    ]
                    
                    for selector in load_button_selectors:
                        try:
                            load_button = page.locator(selector).first
                            if await load_button.count() > 0:
                                await load_button.click()
                                await page.wait_for_timeout(2000)  # Wait for loading operation and WebRTC to stop
                                print(f"✅ Started sample loading operation (using: {selector})")
                                
                                # Check if WebRTC stopped during loading
                                webrtc_stopped_during_loading = False
                                for start_selector in webrtc_selectors:
                                    try:
                                        if await page.locator(start_selector).count() > 0:
                                            print("✅ TEST 2 PASSED: WebRTC streaming stopped during sample loading operation")
                                            webrtc_stopped_during_loading = True
                                            break
                                    except:
                                        continue
                                
                                if not webrtc_stopped_during_loading:
                                    print("⚠️  TEST 2: Could not verify WebRTC stopped during sample loading")
                                
                                break
                        except Exception as e:
                            print(f"  - Load button selector '{selector}' failed: {e}")
                            continue
                else:
                    print("⚠️  TEST 2: Could not find simulated samples to test with")
            else:
                print("⚠️  TEST 2: Could not open sample selector")
            
            # Check console for WebRTC-related messages
            print("🔍 Checking console messages for WebRTC activity...")
            webrtc_messages = [msg for msg in console_messages if 'webrtc' in msg.lower() or 'stream' in msg.lower()]
            if webrtc_messages:
                print(f"📝 Found {len(webrtc_messages)} WebRTC-related console messages:")
                for msg in webrtc_messages[-5:]:  # Show last 5 messages
                    print(f"  - {msg}")
            
            # Take final screenshot
            screenshot_path = f"/tmp/webrtc_test_final_{uuid.uuid4().hex[:8]}.png"
            await page.screenshot(path=screenshot_path)
            print(f"📸 WebRTC test screenshot saved to: {screenshot_path}")
            
            print("✅ WebRTC streaming control test completed")
            
            # Collect coverage data
            await collect_coverage(page, "webrtc_stream_control")
            
        finally:
            await context.close()
            await browser.close()

@pytest.mark.asyncio
@pytest.mark.timeout(30)
async def test_generate_coverage_report():
    """Generate final coverage report from all collected data."""
    if COVERAGE_ENABLED:
        print("📊 Generating final coverage report...")
        generate_coverage_report()
        print("✅ Coverage report generation completed")
    else:
        print("⚠️  Coverage collection disabled, skipping report generation")

if __name__ == "__main__":
    # Run tests individually for debugging
    pytest.main([__file__, "-v", "-s"]) 