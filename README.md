# Agent-Lens: AI-Powered Smart Microscopy Platform

<p align="center">
  <strong>Autonomous microscopy control with LLM-based AI agents</strong>
</p>

<p align="center">
  <a href="https://hypha.aicell.io/agent-lens/apps/agent-lens/">🔬 Try Live Demo</a> |
  <a href="#quick-start">⚡ Quick Start</a> |
  <a href="#installation">📦 Installation</a>
</p>

---

## Overview

Agent-Lens is a web-based platform for intelligent microscopy control, combining:
- **Hardware Control**: Multi-microscope coordination with robotic sample handling
- **AI Integration**: LLM agents, SAM segmentation, CLIP/DINOv2 similarity search
- **Advanced Imaging**: Time-lapse, multi-channel, OME-Zarr data management
- **Interactive UI**: Real-time stage maps, annotations, and visualization

## Quick Start

### Try Online
Visit [https://hypha.aicell.io/agent-lens/apps/agent-lens/](https://hypha.aicell.io/agent-lens/apps/agent-lens/)

### Local Development
```bash
# Setup
bash scripts/setup_dev.sh
conda activate squid

# Connect to Hypha server (no local server needed)
python -m agent_lens connect-server \
    --workspace_name=agent-lens \
    --server_url=https://hypha.aicell.io

# Access at: https://hypha.aicell.io/agent-lens/apps/agent-lens-test/
```

### Docker
```bash
docker pull ghcr.io/aicell-lab/agent-lens:main
docker run -d -p 9527:9527 \
    -e WORKSPACE_TOKEN=$WORKSPACE_TOKEN \
    ghcr.io/aicell-lab/agent-lens:main
```

## Key Features

🔬 **Microscopy**: XYZ positioning, autofocus, multi-channel illumination, well plate navigation  
🤖 **AI Agents**: Natural language control, code generation, autonomous operation  
🔍 **Similarity Search**: CLIP-based annotation matching across datasets  
🧬 **Cell Segmentation**: Fine-tuneable microSAM via BioEngine  
⏱️ **Time-Lapse**: Automated multi-timepoint, multi-position imaging  
🤖 **Robotics**: Automated sample transfer with incubator integration  
💾 **Data**: OME-Zarr format with S3 storage and efficient chunked access  

## Installation

### Prerequisites
- Conda/Miniconda
- Node.js 20+
- Python 3.11+
- Docker (optional)

### Automated Setup
```bash
git clone https://github.com/aicell-lab/agent-lens.git
cd agent-lens
bash scripts/setup_dev.sh
```

This creates a conda environment, installs dependencies, and prompts for Hypha tokens.

### Manual Setup
```bash
# Create environment
conda create -n squid python=3.11
conda activate squid

# Install dependencies
pip install -e ".[test]"
npm install --prefix frontend
playwright install chromium

# Configure tokens
echo "WORKSPACE_TOKEN=your_token" > .env
echo "PERSONAL_TOKEN=your_token" >> .env

# Get tokens from: https://hypha.aicell.io
```

## Configuration

### Environment Variables
```bash
WORKSPACE_TOKEN=<required>      # Get from https://hypha.aicell.io
PERSONAL_TOKEN=<optional>       # For private workspaces
SERVER_URL=https://hypha.aicell.io
LOG_LEVEL=INFO
```

### Service Architecture
```
Hypha Server (hypha.aicell.io)
├── Frontend Service (ASGI + React)
├── Microscope Services (squid-1, squid-2, simulation)
├── Helper Services (Cellpose segmentation, similarity search)
├── BioEngine (Cellpose as BioEngine app)
└── Orchestrator (time-lapse scheduling)
```

## Project Structure

```
agent-lens/
├── agent_lens/                 # Python backend
│   ├── register_frontend_service.py  # ASGI service
│   └── utils/                  # Artifact manager, embeddings
├── frontend/                   # React application
│   ├── components/
│   │   ├── agent/              # AI agent interface
│   │   ├── map_visualization/  # Stage map & OME-Zarr
│   │   ├── similarity_search/  # Vector search UI
│   │   └── microscope_acquisition/  # Scan config
│   └── utils/                  # Zarr loader, embeddings
├── bioengine-app/              # Cellpose & microSAM deployment
├── tests/                      # Test suite
├── docker/                     # Containerization
└── scripts/                    # Automation scripts
```

## Development

### Backend
```bash
conda activate squid
python -m agent_lens connect-server --workspace_name=agent-lens
```

### Frontend
```bash
cd frontend
npm start  # Hot reload at http://localhost:5173
```

### Testing
```bash
# Fast tests (recommended for development)
python scripts/run_tests.py --type fast

# With coverage
python scripts/run_tests.py --coverage

# Frontend E2E
python scripts/run_tests.py --frontend-service

# Component tests
node tests/test-frontend-components/run_tests.js
```

### Building
```bash
# Frontend only
cd frontend && npm run build

# Docker image
docker build -f docker/dockerfile -t agent-lens:latest .
```

## AI Agent Integration

Built-in LLM agents for autonomous microscopy:

- **AgentPanel**: Interactive notebook interface with code execution
- **Code Generation**: Generate control code from natural language
- **Thinking Visualization**: View agent reasoning process
- **Kernel Support**: Browser-based (Pyodide) or cloud-based Python execution

```python
# Agents can generate and execute code like:
await microscope.move_to_well("A1")
await microscope.set_exposure(100)
image = await microscope.capture_image()
```

## BioEngine Services

Deploy microSAM & Cellpose for cell segmentation:

```bash
# Start worker
conda activate microsam
python -m bioengine.worker \
    --workspace agent-lens \
    --head_num_gpus 2

# Deploy service (see bioengine-app/README.md)
python scripts/deploy_cellsegmenter.py
```

Usage:
```python
segmenter = await server.get_service("agent-lens/cell-segmenter")
result = await segmenter.segment_all(image=image)
```

## Core Components

### 1. Microscope Stage Map
Interactive OpenLayers map with:
- Real-time FOV indicator and well plate overlay
- OME-Zarr tile streaming with multi-scale pyramids
- Annotation tools and similarity search layer
- Efficient chunked data loading via artifact manager

### 2. Similarity Search
- Draw annotations to find similar cells across datasets
- CLIP/DINOv2 embeddings
- Cross-experiment and time-series search
- Sub-second queries on thousands of annotations

### 3. Time-Lapse Imaging
- Multi-position, multi-channel acquisition
- Task scheduling with orchestrator service
- Autofocus at each timepoint
- Hardware coordination (microscope + incubator + robotic arm)

### 4. Sample Automation
- Robotic sample transfer between incubator and microscopes
- Collision prevention with operation locking
- State tracking and error recovery

### 5. Data Management
- OME-Zarr format with S3-compatible storage
- Chunked compression for efficient access
- Multi-scale pyramids for visualization
- Artifact manager for datasets and galleries

## Deployment

### Docker Compose
```bash
docker-compose -f docker/docker-compose-agent-lens-app.yml up -d
```

### With GPU Support
```bash
docker run --gpus all \
    -e WORKSPACE_TOKEN=$WORKSPACE_TOKEN \
    ghcr.io/aicell-lab/agent-lens:main
```

### Security
- Non-root user (UID 1000)
- Token-based authentication
- CORS and security headers configured

**Circular dependencies**
```bash
npm run check:circles --prefix frontend
```

**Token errors**
```bash
export WORKSPACE_TOKEN=your_token
```

**Playwright issues**
```bash
playwright install chromium
```

**GPU not detected**
```bash
# Install NVIDIA Container Toolkit
docker run --gpus all ghcr.io/aicell-lab/agent-lens:main
```

### Debug Mode
```bash
export LOG_LEVEL=DEBUG
python scripts/run_tests.py --verbose
```

## Testing

Test categories:
- `--type fast`: Unit tests (< 2s, best for development)
- `--type integration`: Service communication tests
- `--type slow`: AI model tests (CLIP, DINOv2, microSAM, Cellpose)
- `--frontend-service`: Playwright E2E tests
- `--coverage`: Generate coverage reports

CI/CD runs automatically on push via GitHub Actions.

## Technology Stack

**Backend**: FastAPI, Hypha-RPC, PyTorch, CLIP, DINOv2, zarr, scikit-image  
**Frontend**: React 18, Vite, Bootstrap 5, Tailwind CSS, OpenLayers, zarrita  
**Infrastructure**: Docker, GitHub Actions, MinIO, Weaviate  
**AI**: DINOv2, CLIP, BioEngine app for microSAM and Cellpose Segmentation

## Documentation

- [.cursorrules](.cursorrules) - Comprehensive development guidelines
- [tests/README.md](tests/README.md) - Testing documentation
- [bioengine-app/README.md](bioengine-app/README.md) - BioEngine services

## License

MIT License - Copyright (c) 2024 Agent-Lens Contributors

See [LICENSE](LICENSE) for details.
