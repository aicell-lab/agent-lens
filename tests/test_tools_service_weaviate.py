"""
Tests for register_tools_service.py Weaviate integration.

This module tests the Weaviate-based cell storage, similarity search,
and metadata filtering functionality in the tools service.
"""

import pytest
import pytest_asyncio
import dotenv
import uuid
import numpy as np
import base64
from io import BytesIO
from PIL import Image as PILImage

dotenv.load_dotenv()


@pytest.mark.integration
class TestToolsServiceWeaviate:
    """Test Weaviate integration in tools service."""
    
    @pytest_asyncio.fixture
    async def tools_service(self, hypha_server):
        """Create a tools service instance for testing."""
        from agent_lens.register_tools_service import setup_service
        
        server = hypha_server
        test_id = f"test-tools-weaviate-{uuid.uuid4().hex[:8]}"
        
        print(f"Setting up test tools service: {test_id}")
        await setup_service(server, test_id)
        
        service = await server.get_service(test_id)
        yield service
        
        print(f"Cleaning up test tools service: {test_id}")
    
    @pytest_asyncio.fixture
    async def weaviate_service(self):
        """Fixture to get Weaviate service connection with collection setup."""
        from agent_lens.utils.weaviate_search import WeaviateSimilarityService
        
        service = WeaviateSimilarityService()
        connected = await service.connect()
        
        if not connected:
            pytest.skip("Weaviate service not available - skipping integration tests")
        
        # Ensure collection exists (same as service startup)
        collection_name = "Agentlens"
        try:
            collection_exists = await service.collection_exists(collection_name)
            if not collection_exists:
                print(f"Creating collection '{collection_name}' for tests...")
                await service.create_collection(
                    collection_name=collection_name,
                    description="Agent-Lens microscopy cell data collection (test)"
                )
                print(f"✅ Created collection '{collection_name}'")
            else:
                print(f"✓ Collection '{collection_name}' already exists")
        except Exception as e:
            print(f"⚠️ Collection setup warning: {e}")
        
        yield service
        
        await service.disconnect()
    
    @staticmethod
    def _create_test_image(size=(100, 100), channels=3):
        """Create a test microscopy image."""
        if channels == 1:
            return np.random.randint(0, 65535, size, dtype=np.uint16)
        else:
            return np.random.randint(0, 65535, (*size, channels), dtype=np.uint16)
    
    @staticmethod
    def _create_test_mask(size=(100, 100), num_cells=5):
        """Create a test segmentation mask with labeled cells."""
        mask = np.zeros(size, dtype=np.uint32)
        
        # Create simple circular cells
        for i in range(num_cells):
            center_y = np.random.randint(20, size[0] - 20)
            center_x = np.random.randint(20, size[1] - 20)
            radius = np.random.randint(8, 15)
            
            y, x = np.ogrid[:size[0], :size[1]]
            circle_mask = (x - center_x)**2 + (y - center_y)**2 <= radius**2
            mask[circle_mask] = i + 1  # Label cells starting from 1
        
        return mask
    
    @pytest.mark.asyncio
    @pytest.mark.timeout(300)
    async def test_dict_to_weaviate_filter_conversion(self):
        """Test dictionary to Weaviate Filter conversion."""
        from agent_lens.utils.weaviate_search import dict_to_weaviate_filter
        
        # Test single condition with min
        filter_dict = {"area": {"min": 100}}
        result = dict_to_weaviate_filter(filter_dict)
        assert result is not None
        print(f"✅ Single condition filter: {result}")
        
        # Test range condition
        filter_dict = {"area": {"min": 100, "max": 500}}
        result = dict_to_weaviate_filter(filter_dict)
        assert result is not None
        print(f"✅ Range filter: {result}")
        
        # Test multiple properties
        filter_dict = {
            "area": {"min": 100, "max": 500},
            "circularity": {"min": 0.8}
        }
        result = dict_to_weaviate_filter(filter_dict)
        assert result is not None
        print(f"✅ Multiple property filter: {result}")
        
        # Test with gt/lt operators
        filter_dict = {"area": {"gt": 150, "lt": 400}}
        result = dict_to_weaviate_filter(filter_dict)
        assert result is not None
        print(f"✅ GT/LT operators filter: {result}")
        
        # Test with eq operator
        filter_dict = {"circularity": {"eq": 1.0}}
        result = dict_to_weaviate_filter(filter_dict)
        assert result is not None
        print(f"✅ Equal operator filter: {result}")
        
        # Test empty dict
        result = dict_to_weaviate_filter({})
        assert result is None
        print(f"✅ Empty dict returns None")
        
        # Test None input
        result = dict_to_weaviate_filter(None)
        assert result is None
        print(f"✅ None input returns None")
    
    @pytest.mark.asyncio
    @pytest.mark.timeout(600)
    async def test_build_cell_records_weaviate_storage(self, tools_service, weaviate_service):
        """Test that build_cell_records stores data to Weaviate."""
        application_id = f"test-build-cells-{uuid.uuid4().hex[:8]}"
        collection_name = "Agentlens"
        
        try:
            # Create test data
            print("Creating test image and mask...")
            image_data = self._create_test_image(size=(100, 100), channels=3)
            mask = self._create_test_mask(size=(100, 100), num_cells=3)
            
            # Create microscope status
            microscope_status = {
                "current_x": 10.5,
                "current_y": 20.3,
                "pixel_size_xy": 0.65,  # um
                "current_well_location": {
                    "well_id": "A1",
                    "well_center_coordinates": {
                        "x_mm": 10.0,
                        "y_mm": 20.0
                    }
                }
            }
            
            # Ensure application exists
            app_exists = await weaviate_service.application_exists(collection_name, application_id)
            if not app_exists:
                await weaviate_service.create_application(
                    collection_name=collection_name,
                    application_id=application_id,
                    description="Test application for cell storage"
                )
                print(f"✅ Created application: {application_id}")
            
            # Call build_cell_records
            print(f"Calling build_cell_records with application_id: {application_id}")
            records = await tools_service.build_cell_records(
                image_data_np=image_data,
                segmentation_mask=mask,
                microscope_status=microscope_status,
                application_id=application_id
            )
            
            print(f"✅ build_cell_records returned {len(records)} records")
            
            # Verify records have UUIDs
            assert len(records) > 0, "Should return cell records"
            for i, record in enumerate(records):
                assert "uuid" in record, f"Record {i} should have uuid"
                assert "image_id" in record, f"Record {i} should have image_id"
                print(f"  Record {i}: uuid={record['uuid'][:8]}..., image_id={record['image_id']}")
            
            # Verify UUIDs are valid and fetchable from Weaviate
            print("Verifying UUIDs are fetchable from Weaviate...")
            for i, record in enumerate(records[:3]):  # Test first 3
                cell_uuid = record["uuid"]
                try:
                    fetched_cell = await weaviate_service.fetch_by_uuid(
                        collection_name=collection_name,
                        application_id=application_id,
                        object_uuid=cell_uuid
                    )
                    assert fetched_cell is not None, f"Cell with UUID {cell_uuid} should be fetchable"
                    print(f"  ✅ Cell {i} UUID {cell_uuid[:8]}... is valid and fetchable")
                except Exception as e:
                    pytest.fail(f"Failed to fetch cell {i} with UUID {cell_uuid}: {e}")
            
            # Verify data was stored in Weaviate by fetching all
            print("Verifying all data in Weaviate...")
            stored_cells = await weaviate_service.fetch_all_annotations(
                collection_name=collection_name,
                application_id=application_id,
                limit=10
            )
            
            assert len(stored_cells) >= len(records), f"Should have at least {len(records)} cells stored"
            print(f"✅ Verified {len(stored_cells)} cells stored in Weaviate")
            
        finally:
            # Cleanup: delete application
            try:
                await weaviate_service.weaviate_service.applications.delete(
                    collection_name=collection_name,
                    application_id=application_id
                )
                print(f"✅ Cleaned up application: {application_id}")
            except Exception as e:
                print(f"⚠️ Cleanup warning: {e}")
    
    @pytest.mark.asyncio
    @pytest.mark.timeout(600)
    async def test_fetch_cell_data_from_weaviate(self, tools_service, weaviate_service):
        """Test fetching cell data by UUIDs from Weaviate."""
        application_id = f"test-fetch-cells-{uuid.uuid4().hex[:8]}"
        collection_name = "Agentlens"
        
        try:
            # Insert test cells first
            print("Inserting test cells...")
            
            # Ensure application exists
            app_exists = await weaviate_service.application_exists(collection_name, application_id)
            if not app_exists:
                await weaviate_service.create_application(
                    collection_name=collection_name,
                    application_id=application_id,
                    description="Test application for fetching cells"
                )
            
            # Insert test cells
            test_uuids = []
            for i in range(3):
                # Create simple test image
                test_image = PILImage.new('RGB', (50, 50), color='red')
                img_buffer = BytesIO()
                test_image.save(img_buffer, format='PNG')
                img_buffer.seek(0)
                preview_image = base64.b64encode(img_buffer.getvalue()).decode('utf-8')
                
                # Generate test embedding
                test_embedding = [0.1 + i * 0.01] * 512
                
                result = await weaviate_service.insert_image(
                    collection_name=collection_name,
                    application_id=application_id,
                    image_id=f"test_cell_{i}",
                    description=f"Test cell {i}",
                    metadata={"test_index": i},
                    vector=test_embedding,
                    preview_image=preview_image,
                    area=100.0 + i * 50,
                    perimeter=40.0 + i * 5,
                    circularity=0.9 - i * 0.05
                )
                
                # Extract UUID
                if hasattr(result, 'uuid'):
                    test_uuids.append(str(result.uuid))
                elif hasattr(result, 'id'):
                    test_uuids.append(str(result.id))
                elif isinstance(result, dict):
                    test_uuids.append(str(result.get('uuid') or result.get('id')))
            
            print(f"✅ Inserted {len(test_uuids)} test cells")
            
            # Test fetch_cell_data
            print(f"Fetching cells by UUIDs: {[u[:8] + '...' for u in test_uuids]}")
            fetched_cells = await tools_service.fetch_cell_data(
                uuids=test_uuids,
                application_id=application_id
            )
            
            assert len(fetched_cells) == len(test_uuids), f"Should fetch {len(test_uuids)} cells"
            print(f"✅ Fetched {len(fetched_cells)} cells")
            
            # Verify cell data
            for i, cell in enumerate(fetched_cells):
                assert "uuid" in cell, f"Cell {i} should have uuid"
                assert "image" in cell, f"Cell {i} should have image"
                assert cell["uuid"] in test_uuids, f"Cell {i} UUID should be in test_uuids"
                print(f"  Cell {i}: uuid={cell['uuid'][:8]}..., has_image={len(cell.get('image', '')) > 0}")
            
        finally:
            # Cleanup
            try:
                await weaviate_service.weaviate_service.applications.delete(
                    collection_name=collection_name,
                    application_id=application_id
                )
                print(f"✅ Cleaned up application: {application_id}")
            except Exception as e:
                print(f"⚠️ Cleanup warning: {e}")
    
    @pytest.mark.asyncio
    @pytest.mark.timeout(600)
    async def test_similarity_search_with_metadata_filters(self, tools_service, weaviate_service):
        """Test similarity search with metadata filtering."""
        application_id = f"test-similarity-{uuid.uuid4().hex[:8]}"
        collection_name = "Agentlens"
        
        try:
            # Insert test cells with different areas
            print("Inserting test cells with varying metadata...")
            
            # Ensure application exists
            app_exists = await weaviate_service.application_exists(collection_name, application_id)
            if not app_exists:
                await weaviate_service.create_application(
                    collection_name=collection_name,
                    application_id=application_id,
                    description="Test application for similarity search"
                )
            
            test_cells = []
            for i in range(5):
                # Create test image
                test_image = PILImage.new('RGB', (50, 50), color='blue')
                img_buffer = BytesIO()
                test_image.save(img_buffer, format='PNG')
                img_buffer.seek(0)
                preview_image = base64.b64encode(img_buffer.getvalue()).decode('utf-8')
                
                # Generate similar embeddings so similarity search works
                test_embedding = [0.5 + i * 0.01] * 512
                
                # Vary the area metadata
                area = 100.0 + i * 100.0  # 100, 200, 300, 400, 500
                
                result = await weaviate_service.insert_image(
                    collection_name=collection_name,
                    application_id=application_id,
                    image_id=f"test_cell_{i}",
                    description=f"Test cell {i}",
                    metadata={"test_index": i},
                    vector=test_embedding,
                    preview_image=preview_image,
                    area=area,
                    perimeter=40.0 + i * 5,
                    circularity=0.9 - i * 0.05
                )
                
                # Extract UUID
                cell_uuid = None
                if hasattr(result, 'uuid'):
                    cell_uuid = str(result.uuid)
                elif hasattr(result, 'id'):
                    cell_uuid = str(result.id)
                elif isinstance(result, dict):
                    cell_uuid = str(result.get('uuid') or result.get('id'))
                
                test_cells.append({
                    "uuid": cell_uuid,
                    "area": area
                })
            
            print(f"✅ Inserted {len(test_cells)} test cells with areas: {[c['area'] for c in test_cells]}")
            
            # Test 1: Search without filters (should return all)
            print("\nTest 1: Search without filters")
            results = await tools_service.similarity_search_cells(
                query_cell_uuids=[test_cells[0]["uuid"]],
                application_id=application_id,
                n_results=10,
                metadata_filters=None
            )
            print(f"  Results without filter: {len(results)} cells")
            assert len(results) >= 4, "Should return at least 4 cells (excluding query)"
            
            # Test 2: Filter by area > 250 (should return cells with area 300, 400, 500)
            print("\nTest 2: Filter by area > 250")
            results = await tools_service.similarity_search_cells(
                query_cell_uuids=[test_cells[0]["uuid"]],
                application_id=application_id,
                n_results=10,
                metadata_filters={"area": {"gt": 250}}
            )
            print(f"  Results with area > 250: {len(results)} cells")
            for r in results:
                area = r.get("area")
                print(f"    Cell area: {area}")
                if area is not None:
                    assert area > 250, f"Cell area {area} should be > 250"
            
            # Test 3: Filter by area range (200-400)
            print("\nTest 3: Filter by area range (200-400)")
            results = await tools_service.similarity_search_cells(
                query_cell_uuids=[test_cells[0]["uuid"]],
                application_id=application_id,
                n_results=10,
                metadata_filters={"area": {"min": 200, "max": 400}}
            )
            print(f"  Results with area 200-400: {len(results)} cells")
            for r in results:
                area = r.get("area")
                print(f"    Cell area: {area}")
                if area is not None:
                    assert 200 <= area <= 400, f"Cell area {area} should be between 200-400"
            
            print("\n✅ All metadata filtering tests passed!")
            
        finally:
            # Cleanup
            try:
                await weaviate_service.weaviate_service.applications.delete(
                    collection_name=collection_name,
                    application_id=application_id
                )
                print(f"✅ Cleaned up application: {application_id}")
            except Exception as e:
                print(f"⚠️ Cleanup warning: {e}")
    
    @pytest.mark.asyncio
    @pytest.mark.timeout(300)
    async def test_reset_application(self, tools_service, weaviate_service):
        """Test resetting an application (deleting all cells)."""
        application_id = f"test-reset-{uuid.uuid4().hex[:8]}"
        collection_name = "Agentlens"
        
        try:
            # Create application and insert test cells
            print("Creating test application and cells...")
            
            app_exists = await weaviate_service.application_exists(collection_name, application_id)
            if not app_exists:
                await weaviate_service.create_application(
                    collection_name=collection_name,
                    application_id=application_id,
                    description="Test application for reset"
                )
            
            # Insert a test cell
            test_image = PILImage.new('RGB', (50, 50), color='green')
            img_buffer = BytesIO()
            test_image.save(img_buffer, format='PNG')
            img_buffer.seek(0)
            preview_image = base64.b64encode(img_buffer.getvalue()).decode('utf-8')
            
            await weaviate_service.insert_image(
                collection_name=collection_name,
                application_id=application_id,
                image_id="test_cell_reset",
                description="Test cell for reset",
                metadata={"test": "reset"},
                vector=[0.5] * 512,
                preview_image=preview_image
            )
            
            print("✅ Created application with test cell")
            
            # Verify cell exists
            cells_before = await weaviate_service.fetch_all_annotations(
                collection_name=collection_name,
                application_id=application_id,
                limit=10
            )
            assert len(cells_before) > 0, "Should have at least 1 cell before reset"
            print(f"  Cells before reset: {len(cells_before)}")
            
            # Reset application
            print("Resetting application...")
            result = await tools_service.reset_application(application_id=application_id)
            
            assert result["success"] is True, "Reset should succeed"
            print(f"✅ Reset result: {result['message']}")
            
            # Verify application no longer exists
            app_exists_after = await weaviate_service.application_exists(collection_name, application_id)
            assert not app_exists_after, "Application should not exist after reset"
            print("✅ Application successfully deleted")
            
        finally:
            # Cleanup (in case test failed before reset)
            try:
                await weaviate_service.weaviate_service.applications.delete(
                    collection_name=collection_name,
                    application_id=application_id
                )
            except:
                pass  # Already deleted
    
    @pytest.mark.asyncio
    @pytest.mark.timeout(120)
    async def test_weaviate_service_initialization(self):
        """Test that WeaviateSimilarityService initializes correctly."""
        from agent_lens.utils.weaviate_search import WeaviateSimilarityService
        
        service = WeaviateSimilarityService()
        assert service is not None
        assert not service.connected  # Should not be connected initially
        
        # Try to connect
        connected = await service.connect()
        
        if not connected:
            pytest.skip("Weaviate service not available")
        
        assert service.connected
        assert service.weaviate_service is not None
        print("✅ Weaviate service initialized and connected")
        
        # Disconnect
        await service.disconnect()
        assert not service.connected
        print("✅ Weaviate service disconnected")


@pytest.mark.unit
class TestWeaviateUtilityFunctions:
    """Test utility functions for Weaviate integration."""
    
    def test_dict_to_weaviate_filter_basic(self):
        """Test basic dictionary to Weaviate Filter conversion."""
        from agent_lens.utils.weaviate_search import dict_to_weaviate_filter
        
        # Test with min/max
        result = dict_to_weaviate_filter({"area": {"min": 100, "max": 500}})
        assert result is not None
        
        # Test with gt/lt
        result = dict_to_weaviate_filter({"area": {"gt": 100, "lt": 500}})
        assert result is not None
        
        # Test with eq
        result = dict_to_weaviate_filter({"circularity": {"eq": 1.0}})
        assert result is not None
        
        # Test with ne
        result = dict_to_weaviate_filter({"area": {"ne": 0}})
        assert result is not None
        
        # Test empty dict
        result = dict_to_weaviate_filter({})
        assert result is None
        
        # Test None
        result = dict_to_weaviate_filter(None)
        assert result is None
        
        print("✅ All dict_to_weaviate_filter tests passed")
    
    def test_dict_to_weaviate_filter_multiple_conditions(self):
        """Test multiple conditions in filter."""
        from agent_lens.utils.weaviate_search import dict_to_weaviate_filter
        
        # Multiple properties
        result = dict_to_weaviate_filter({
            "area": {"min": 100, "max": 500},
            "circularity": {"min": 0.8}
        })
        assert result is not None
        
        # Multiple conditions on same property
        result = dict_to_weaviate_filter({"area": {"gt": 100, "lt": 500, "ne": 250}})
        assert result is not None
        
        print("✅ Multiple condition filter tests passed")
    
    def test_service_codecs_imports(self):
        """Test that service codecs can be imported."""
        from agent_lens.utils.service_codecs import register_weaviate_codecs
        
        assert register_weaviate_codecs is not None
        print("✅ Service codecs imports successful")
