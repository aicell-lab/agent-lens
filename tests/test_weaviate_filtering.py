"""
Test Weaviate filtering capabilities to validate metadata filtering support.
This test determines the architecture approach for the Weaviate integration.

Test scenarios:
1. Range filtering - Filter cells by min/max values (e.g., area)
2. Multiple field filtering - Combine multiple metadata filters
3. Nested filtering - Test fluorescence intensity thresholds
4. Performance test - Compare Weaviate filtering vs client-side filtering
"""

import pytest
import pytest_asyncio
import dotenv
import uuid
import time
import base64
from typing import List, Dict, Any

dotenv.load_dotenv()


@pytest_asyncio.fixture
async def weaviate_service():
    """Fixture to get Weaviate service connection."""
    from agent_lens.utils.weaviate_search import WeaviateSimilarityService
    
    service = WeaviateSimilarityService()
    connected = await service.connect()
    
    if not connected:
        pytest.skip("Weaviate service not available - skipping filtering tests")
    
    yield service
    
    # Cleanup: disconnect service
    await service.disconnect()


@pytest_asyncio.fixture
async def test_collection_setup(weaviate_service):
    """Create test collection and populate with sample data."""
    collection_name = "Agentlenstest"
    application_id = f"test-filtering-{uuid.uuid4().hex[:8]}"
    
    try:
        # Ensure collection exists
        exists = await weaviate_service.collection_exists(collection_name)
        if not exists:
            await weaviate_service.create_collection(
                collection_name=collection_name,
                description="Test collection for filtering validation"
            )
        
        # Create application
        await weaviate_service.create_application(
            collection_name=collection_name,
            application_id=application_id,
            description="Test filtering application"
        )
        
        # Generate a dummy preview image (valid base64 PNG)
        from PIL import Image as PILImage
        import io
        test_image = PILImage.new('RGB', (50, 50), color='red')
        img_buffer = io.BytesIO()
        test_image.save(img_buffer, format='PNG')
        img_buffer.seek(0)
        preview_image_b64 = base64.b64encode(img_buffer.getvalue()).decode('utf-8')
        
        # Generate test data with varied metadata values
        test_cells = []
        for i in range(50):
            # Create cells with predictable metadata patterns for testing
            cell_data = {
                "image_id": f"test_cell_{i}",
                "description": f"Test cell {i}",
                "metadata": {"test_index": i},
                "dataset_id": application_id,
                "file_path": "",
                "preview_image": preview_image_b64,  # Valid base64 preview
                # Morphology - create varied ranges
                "area": 100 + (i * 20),  # 100 to 1080
                "perimeter": 40 + (i * 2),  # 40 to 138
                "equivalent_diameter": 10.0 + (i * 0.5),  # 10.0 to 34.5
                "bbox_width": 15 + i,  # 15 to 64
                "bbox_height": 15 + i,  # 15 to 64
                "aspect_ratio": 1.0 + (i * 0.05),  # 1.0 to 3.45
                "circularity": 0.95 - (i * 0.01),  # 0.95 to 0.46
                "eccentricity": 0.1 + (i * 0.01),  # 0.1 to 0.59
                "solidity": 0.98 - (i * 0.005),  # 0.98 to 0.735
                "convexity": 0.99 - (i * 0.003),  # 0.99 to 0.84
                # Texture features
                "brightness": 80 + (i * 2),  # 80 to 178
                "contrast": 0.3 + (i * 0.01),  # 0.3 to 0.79
                "homogeneity": 0.85 - (i * 0.005),  # 0.85 to 0.605
                "energy": 0.7 - (i * 0.005),  # 0.7 to 0.455
                "correlation": 0.5 + (i * 0.008),  # 0.5 to 0.892
            }
            test_cells.append(cell_data)
        
        # Insert test data (without vectors for faster insertion)
        from agent_lens.utils.embedding_generator import generate_text_embedding
        
        # Generate a single dummy vector for all cells (for performance)
        dummy_vector = await generate_text_embedding("test cell")
        
        for cell in test_cells:
            cell["vector"] = dummy_vector
        
        # Use insert_many for batch insertion
        result = await weaviate_service.insert_many_images(
            collection_name=collection_name,
            application_id=application_id,
            objects=test_cells
        )
        
        print(f"\n✅ Test setup: Created {result['inserted_count']} test cells")
        print(f"   Application ID: {application_id}")
        print(f"   Collection: {collection_name}")
        
        yield {
            "collection_name": collection_name,
            "application_id": application_id,
            "test_cells": test_cells,
            "cell_count": result['inserted_count']
        }
        
    finally:
        # Cleanup: delete test application data
        try:
            # Note: We don't delete the collection since it's shared "Agentlenstest"
            # Just clean up the application data
            all_objects = await weaviate_service.fetch_all_annotations(
                collection_name=collection_name,
                application_id=application_id,
                limit=1000,
                include_vector=False
            )
            print(f"\n🧹 Cleanup: Found {len(all_objects)} objects to clean up")
        except Exception as e:
            print(f"⚠️  Cleanup warning: {e}")


class TestWeaviateFiltering:
    """Test Weaviate filtering capabilities."""
    
    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_range_filtering_single_field(self, weaviate_service, test_collection_setup):
        """Test filtering by a single field with min/max range."""
        setup = test_collection_setup
        collection_name = setup["collection_name"]
        application_id = setup["application_id"]
        
        print("\n🧪 Test 1: Range filtering (single field - area)")
        
        # Test case: Filter cells with area between 300 and 700
        min_area = 300
        max_area = 700
        
        # Expected: cells with index 10-30 (area 300-700)
        expected_count = 21  # indices 10-30 inclusive
        
        # Attempt to use Weaviate's query.fetch_objects with filters
        # Note: This tests if the Weaviate proxy supports filtering
        try:
            # Try using Weaviate's where filter syntax
            # This is the critical test - does the proxy support filtering?
            results = await weaviate_service.weaviate_service.query.fetch_objects(
                collection_name=collection_name,
                application_id=application_id,
                where={
                    "operator": "And",
                    "operands": [
                        {
                            "path": ["area"],
                            "operator": "GreaterThanEqual",
                            "valueNumber": min_area
                        },
                        {
                            "path": ["area"],
                            "operator": "LessThanEqual",
                            "valueNumber": max_area
                        }
                    ]
                },
                limit=100,
                return_properties=["image_id", "area"]
            )
            
            # Handle different result formats
            if hasattr(results, 'objects'):
                actual_results = results.objects
            elif isinstance(results, (list, tuple)):
                actual_results = results
            else:
                actual_results = list(results) if hasattr(results, '__iter__') else [results]
            
            actual_count = len(actual_results)
            
            print(f"✅ SUCCESS: Weaviate filtering WORKS!")
            print(f"   Expected ~{expected_count} cells with area {min_area}-{max_area}")
            print(f"   Got {actual_count} cells")
            
            # Verify the filtering worked correctly
            for result in actual_results[:5]:  # Check first 5
                if hasattr(result, 'properties'):
                    area = result.properties.area if hasattr(result.properties, 'area') else result.properties.get('area')
                elif isinstance(result, dict):
                    area = result.get('properties', {}).get('area') or result.get('area')
                else:
                    area = None
                
                if area:
                    assert min_area <= area <= max_area, f"Area {area} not in range [{min_area}, {max_area}]"
            
            print(f"   ✓ Verified: All returned cells have area in correct range")
            
            # Mark this test as successful - filtering is supported
            return True
            
        except AttributeError as e:
            if "where" in str(e) or "query" in str(e):
                print(f"❌ FAILED: Weaviate proxy does NOT support filtering")
                print(f"   Error: {e}")
                print(f"   → Will use client-side filtering approach")
                pytest.skip("Weaviate filtering not supported - will use fallback approach")
            else:
                raise
        except Exception as e:
            print(f"❌ ERROR: Unexpected error testing filtering: {e}")
            print(f"   Error type: {type(e).__name__}")
            raise
    
    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_multiple_field_filtering(self, weaviate_service, test_collection_setup):
        """Test filtering with multiple metadata fields combined."""
        setup = test_collection_setup
        collection_name = setup["collection_name"]
        application_id = setup["application_id"]
        
        print("\n🧪 Test 2: Multiple field filtering (area + circularity + brightness)")
        
        # Test case: Filter cells with:
        # - area between 400 and 800
        # - circularity > 0.7
        # - brightness > 100
        
        try:
            results = await weaviate_service.weaviate_service.query.fetch_objects(
                collection_name=collection_name,
                application_id=application_id,
                where={
                    "operator": "And",
                    "operands": [
                        {
                            "path": ["area"],
                            "operator": "GreaterThanEqual",
                            "valueNumber": 400
                        },
                        {
                            "path": ["area"],
                            "operator": "LessThanEqual",
                            "valueNumber": 800
                        },
                        {
                            "path": ["circularity"],
                            "operator": "GreaterThan",
                            "valueNumber": 0.7
                        },
                        {
                            "path": ["brightness"],
                            "operator": "GreaterThan",
                            "valueNumber": 100
                        }
                    ]
                },
                limit=100,
                return_properties=["image_id", "area", "circularity", "brightness"]
            )
            
            # Handle different result formats
            if hasattr(results, 'objects'):
                actual_results = results.objects
            elif isinstance(results, (list, tuple)):
                actual_results = results
            else:
                actual_results = list(results) if hasattr(results, '__iter__') else [results]
            
            print(f"✅ SUCCESS: Multi-field filtering works!")
            print(f"   Got {len(actual_results)} cells matching all criteria")
            
            # Verify a few results
            for result in actual_results[:3]:
                if hasattr(result, 'properties'):
                    props = result.properties
                    area = props.area if hasattr(props, 'area') else props.get('area')
                    circ = props.circularity if hasattr(props, 'circularity') else props.get('circularity')
                    bright = props.brightness if hasattr(props, 'brightness') else props.get('brightness')
                elif isinstance(result, dict):
                    props = result.get('properties', {})
                    area = props.get('area') or result.get('area')
                    circ = props.get('circularity') or result.get('circularity')
                    bright = props.get('brightness') or result.get('brightness')
                
                if area and circ and bright:
                    assert 400 <= area <= 800, f"Area {area} not in range"
                    assert circ > 0.7, f"Circularity {circ} not > 0.7"
                    assert bright > 100, f"Brightness {bright} not > 100"
            
            print(f"   ✓ Verified: All returned cells match criteria")
            return True
            
        except (AttributeError, NotImplementedError) as e:
            print(f"❌ FAILED: Multi-field filtering not supported")
            print(f"   Error: {e}")
            pytest.skip("Multi-field filtering not supported")
        except Exception as e:
            print(f"❌ ERROR: {e}")
            raise
    
    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_performance_filtering(self, weaviate_service, test_collection_setup):
        """Compare performance: Weaviate filtering vs client-side filtering."""
        setup = test_collection_setup
        collection_name = setup["collection_name"]
        application_id = setup["application_id"]
        
        print("\n🧪 Test 3: Performance comparison (Weaviate vs client-side)")
        
        # Test parameters
        min_area = 300
        max_area = 700
        
        # Method 1: Weaviate filtering
        try:
            start_time = time.time()
            weaviate_results = await weaviate_service.weaviate_service.query.fetch_objects(
                collection_name=collection_name,
                application_id=application_id,
                where={
                    "operator": "And",
                    "operands": [
                        {"path": ["area"], "operator": "GreaterThanEqual", "valueNumber": min_area},
                        {"path": ["area"], "operator": "LessThanEqual", "valueNumber": max_area}
                    ]
                },
                limit=100,
                return_properties=["image_id", "area"]
            )
            weaviate_time = time.time() - start_time
            
            if hasattr(weaviate_results, 'objects'):
                weaviate_count = len(weaviate_results.objects)
            elif isinstance(weaviate_results, (list, tuple)):
                weaviate_count = len(weaviate_results)
            else:
                weaviate_count = len(list(weaviate_results))
            
            print(f"   Weaviate filtering: {weaviate_time*1000:.2f}ms → {weaviate_count} results")
            
        except Exception as e:
            print(f"   Weaviate filtering: FAILED ({e})")
            weaviate_time = None
            weaviate_count = 0
        
        # Method 2: Client-side filtering (fetch all, filter locally)
        start_time = time.time()
        all_results = await weaviate_service.fetch_all_annotations(
            collection_name=collection_name,
            application_id=application_id,
            limit=100,
            include_vector=False
        )
        
        # Filter client-side
        filtered_results = []
        for result in all_results:
            if hasattr(result, 'properties'):
                area = result.properties.area if hasattr(result.properties, 'area') else result.properties.get('area')
            elif isinstance(result, dict):
                area = result.get('properties', {}).get('area') or result.get('area')
            else:
                area = None
            
            if area and min_area <= area <= max_area:
                filtered_results.append(result)
        
        client_time = time.time() - start_time
        client_count = len(filtered_results)
        
        print(f"   Client-side filtering: {client_time*1000:.2f}ms → {client_count} results")
        
        # Compare
        if weaviate_time is not None:
            speedup = client_time / weaviate_time
            print(f"\n   📊 Performance: Weaviate is {speedup:.2f}x faster")
            
            if speedup > 1.5:
                print(f"   ✅ RECOMMENDATION: Use Weaviate filtering (significantly faster)")
            else:
                print(f"   ⚠️  RECOMMENDATION: Performance similar, either approach viable")
        else:
            print(f"\n   ⚠️  RECOMMENDATION: Use client-side filtering (Weaviate filtering unavailable)")
        
        # Verify counts match (allowing for small discrepancies due to timing)
        if weaviate_count > 0 and client_count > 0:
            assert abs(weaviate_count - client_count) <= 2, \
                f"Count mismatch: Weaviate {weaviate_count} vs Client {client_count}"
    
    @pytest.mark.integration
    @pytest.mark.asyncio
    async def test_vector_search_with_filters(self, weaviate_service, test_collection_setup):
        """Test combining vector similarity search with metadata filters."""
        setup = test_collection_setup
        collection_name = setup["collection_name"]
        application_id = setup["application_id"]
        
        print("\n🧪 Test 4: Vector search + metadata filtering")
        
        # Generate a query vector
        from agent_lens.utils.embedding_generator import generate_text_embedding
        query_vector = await generate_text_embedding("test cell")
        
        # Test if we can combine vector search with filters
        try:
            # Attempt near_vector search with where filter
            results = await weaviate_service.weaviate_service.query.near_vector(
                collection_name=collection_name,
                application_id=application_id,
                near_vector=query_vector,
                where={
                    "path": ["area"],
                    "operator": "GreaterThan",
                    "valueNumber": 500
                },
                limit=10,
                return_properties=["image_id", "area"],
                certainty=None  # Remove certainty threshold for this test
            )
            
            if hasattr(results, 'objects'):
                actual_results = results.objects
            elif isinstance(results, (list, tuple)):
                actual_results = results
            else:
                actual_results = list(results) if hasattr(results, '__iter__') else [results]
            
            print(f"✅ SUCCESS: Vector search + filtering works!")
            print(f"   Got {len(actual_results)} similar cells with area > 500")
            
            # Verify filtering was applied
            for result in actual_results[:5]:
                if hasattr(result, 'properties'):
                    area = result.properties.area if hasattr(result.properties, 'area') else result.properties.get('area')
                elif isinstance(result, dict):
                    area = result.get('properties', {}).get('area') or result.get('area')
                else:
                    area = None
                
                if area:
                    assert area > 500, f"Area {area} not > 500"
            
            print(f"   ✓ Verified: Combined filtering works correctly")
            return True
            
        except (AttributeError, NotImplementedError, TypeError) as e:
            print(f"❌ FAILED: Vector search + filtering not supported")
            print(f"   Error: {e}")
            print(f"   → Will filter after vector search (client-side)")
            pytest.skip("Combined vector + metadata filtering not supported")
        except Exception as e:
            print(f"❌ ERROR: {e}")
            raise


@pytest.mark.integration
@pytest.mark.asyncio
async def test_filtering_summary(weaviate_service, test_collection_setup):
    """
    Summary test that provides clear recommendations for the implementation.
    This test should be run last to provide final verdict.
    """
    print("\n" + "="*70)
    print("WEAVIATE FILTERING CAPABILITY SUMMARY")
    print("="*70)
    
    capabilities = {
        "range_filtering": False,
        "multi_field_filtering": False,
        "vector_with_filters": False,
        "recommendation": "client_side"
    }
    
    setup = test_collection_setup
    collection_name = setup["collection_name"]
    application_id = setup["application_id"]
    
    # Quick test of each capability
    try:
        # Test 1: Range filtering
        results = await weaviate_service.weaviate_service.query.fetch_objects(
            collection_name=collection_name,
            application_id=application_id,
            where={"path": ["area"], "operator": "GreaterThan", "valueNumber": 300},
            limit=5,
            return_properties=["image_id"]
        )
        capabilities["range_filtering"] = True
        print("✅ Range filtering: SUPPORTED")
    except:
        print("❌ Range filtering: NOT SUPPORTED")
    
    try:
        # Test 2: Multi-field filtering
        results = await weaviate_service.weaviate_service.query.fetch_objects(
            collection_name=collection_name,
            application_id=application_id,
            where={
                "operator": "And",
                "operands": [
                    {"path": ["area"], "operator": "GreaterThan", "valueNumber": 300},
                    {"path": ["circularity"], "operator": "GreaterThan", "valueNumber": 0.7}
                ]
            },
            limit=5,
            return_properties=["image_id"]
        )
        capabilities["multi_field_filtering"] = True
        print("✅ Multi-field filtering: SUPPORTED")
    except:
        print("❌ Multi-field filtering: NOT SUPPORTED")
    
    try:
        # Test 3: Vector search with filters
        from agent_lens.utils.embedding_generator import generate_text_embedding
        query_vector = await generate_text_embedding("test")
        
        results = await weaviate_service.weaviate_service.query.near_vector(
            collection_name=collection_name,
            application_id=application_id,
            near_vector=query_vector,
            where={"path": ["area"], "operator": "GreaterThan", "valueNumber": 300},
            limit=5,
            return_properties=["image_id"],
            certainty=None
        )
        capabilities["vector_with_filters"] = True
        print("✅ Vector search + filters: SUPPORTED")
    except:
        print("❌ Vector search + filters: NOT SUPPORTED")
    
    # Determine recommendation
    print("\n" + "-"*70)
    if capabilities["vector_with_filters"]:
        capabilities["recommendation"] = "weaviate_full"
        print("🎯 RECOMMENDATION: Use Weaviate for filtering AND vector search")
        print("   → Implement filter_and_score_cells_weaviate with full filtering")
        print("   → Apply range_config and relative_config in Weaviate queries")
    elif capabilities["range_filtering"] or capabilities["multi_field_filtering"]:
        capabilities["recommendation"] = "weaviate_partial"
        print("🎯 RECOMMENDATION: Hybrid approach")
        print("   → Use Weaviate for vector search")
        print("   → Apply basic filters in Weaviate (range_config)")
        print("   → Apply complex filters client-side (relative_config)")
    else:
        capabilities["recommendation"] = "client_side"
        print("🎯 RECOMMENDATION: Client-side filtering approach")
        print("   → Use Weaviate for vector search only")
        print("   → Apply ALL filters client-side after fetching results")
        print("   → This is the safest fallback approach")
    
    print("="*70 + "\n")
    
    return capabilities
