#!/usr/bin/env python3
"""
Deploy CellSegmenter service to BioEngine worker.
Multi-model cell segmentation service supporting microSAM and Cellpose.
"""
import asyncio
import os
from dotenv import load_dotenv
from hypha_rpc import connect_to_server, login

async def deploy_cellsegmenter():
    print("Connecting to BioEngine worker...")
    
    # Load .env file if it exists
    load_dotenv()
    
    # Use HYPHA_TOKEN from environment if available, otherwise login
    token = os.getenv("HYPHA_TOKEN") or await login({"server_url": "https://hypha.aicell.io"})
    # Connect to BioEngine worker
    server = await connect_to_server({
        "server_url": "https://hypha.aicell.io",
        "token": token,
    })
    # Songtao's workspace
    workspace = "agent-lens"
    # Get the worker service
    worker = await server.get_service(f"{workspace}/cell_segmenter:bioengine-worker")
    
    print("Loading CellSegmenter service files...")
    
    # Load service files - BioEngine expects files with type and content
    files = [
        {
            "name": "cell-segmenter.py",
            "type": "text",
            "content": open("bioengine-app/cell-segmenter.py", "r").read()
        },
        {
            "name": "manifest.yaml", 
            "type": "text",
            "content": open("bioengine-app/manifest.yaml", "r").read()
        }
    ]
    
    print("Deploying CellSegmenter service...")
    
    # Deploy the service
    await worker.save_application(files)
    
    # Run application with token if available
    app_params = {"artifact_id": "cell-segmenter", "application_id": "cell-segmenter"}
    if os.getenv("HYPHA_TOKEN"):
        app_params["hypha_token"] = os.getenv("HYPHA_TOKEN")
    
    await worker.run_application(**app_params)
    
    print("✅ CellSegmenter service deployed successfully!")
    
    # Wait for the service to be deployed and started
    print("Waiting for service to start up...")
    await asyncio.sleep(50)  # Wait longer for Ray Serve to start
    
    # Get the actual service name from the deployment
    print("Getting deployed service name...")
    applications = await worker.list_applications()
    print(f"Available applications: {list(applications.keys())}")
    
    # Connect directly to the deployed cell-segmenter application
    print("Connecting to deployed CellSegmenter application...")
    
    try:
        # Find the cell-segmenter application (it might have a prefix like 'agent-lens/')
        cellsegmenter_app_name = None
        for app_name in applications.keys():
            if app_name.endswith('/cell-segmenter') or app_name == 'cell-segmenter':
                cellsegmenter_app_name = app_name
                break
        
        if not cellsegmenter_app_name:
            print("❌ cell-segmenter application not found in deployed applications")
            print(f"Available applications: {list(applications.keys())}")
            return
        
        print(f"✅ Found CellSegmenter application: {cellsegmenter_app_name}")
        
        # Get the service from the application
        print("Getting CellSegmenter service...")
        cellsegmenter = await server.get_service(cellsegmenter_app_name)
        
        # Test the service with retry logic
        print("\nTesting service...")
        max_retries = 3
        retry_delay = 5
        
        for attempt in range(max_retries):
            try:
                print(f"Attempt {attempt + 1}/{max_retries}...")
                
                # Check if service is working
                status = await cellsegmenter.get_fit_status()
                print(f"✅ Service is working! Status: {status['status']}")
                
                break
            except Exception as e:
                print(f"⚠️  Attempt {attempt + 1} failed: {e}")
                if attempt < max_retries - 1:
                    print(f"Retrying in {retry_delay} seconds...")
                    await asyncio.sleep(retry_delay)
                else:
                    print("❌ All attempts failed. Service may need more time to start.")
                    print("You can try connecting to the service manually later.")
                    
    except Exception as e:
        print(f"❌ Error connecting to CellSegmenter service: {e}")
        print("The application was deployed but the service may not be running yet.")
    
if __name__ == "__main__":
    asyncio.run(deploy_cellsegmenter())

