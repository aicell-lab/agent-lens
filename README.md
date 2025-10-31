# Agent-Lens: AI-Powered Smart Microscopy Platform

<p align="center">
  <strong>An intelligent web application for autonomous microscopy control and advanced image analysis</strong>
</p>

<p align="center">
  <a href="https://hypha.aicell.io/agent-lens/apps/agent-lens/">🔬 Try Agent-Lens</a> |
  <a href="#quick-start">⚡ Quick Start</a> |
  <a href="#features">✨ Features</a> |
  <a href="#documentation">📖 Documentation</a>
</p>

---

## Table of Contents

- [Overview](#overview)
- [Key Features](#key-features)
- [Technology Stack](#technology-stack)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Configuration](#configuration)
- [Project Structure](#project-structure)
- [Core Components](#core-components)
- [Development](#development)
- [Contributing](#contributing)
- [License](#license)

## Overview

**Agent-Lens** is an AI-powered smart microscopy web application that provides autonomous control of microscopy hardware with LLM-based AI agents. The platform integrates multiple microscope control, real-time image analysis, advanced data acquisition, and intelligent decision-making capabilities.

Built for research laboratories, Agent-Lens combines modern web technologies with cutting-edge AI to streamline microscopy workflows and enable automated biological imaging.

## Key Features

### 🔬 **Microscopy Control**
- **Multi-dimensional Control**: X, Y, Z positioning with precision movement
- **Illumination Management**: Support for multiple channels (BF LED matrix full, Fluorescence 405 nm Ex, Fluorescence 488 nm Ex, Fluorescence 561 nm Ex, Fluorescence 638 nm Ex, Fluorescence 730 nm Ex)
- **Camera Control**: Adjustable exposure time and intensity settings
- **Autofocus**: Contrast-based and laser-based autofocus algorithms
- **Well Plate Navigation**: Support for 96, 48, and 24-well plate formats

### 🤖 **AI-Powered Analysis**
- **Similarity Search**: Vector-based image similarity matching
- **LLM Integration**: Natural language control and assistance
- **Real-time Processing**: Live image analysis and feedback

### 🎯 **Advanced Imaging**
- **Time-lapse Imaging**: Automated multi-timepoint acquisition
- **Multi-channel Acquisition**: Simultaneous fluorescence and brightfield
- **Annotation Tools**: Points, polygons, and custom markers
- **Data Management**: Zarrita-based efficient storage and retrieval with zip endpoints
- **Interactive Stage Map**: Pan/zoomable stage map with well plate overlay, scan area selection, and multi-well support

### 🏭 **Hardware Integration**
- **Robotic Automation**: Automated sample handling and transfer
- **Incubator Control**: Multi-slot sample management
- **Multi-microscope Support**: Coordinate multiple imaging systems
- **Safety Systems**: Collision prevention and operation locking
- **Real-time Streaming**: WebRTC video from microscope feeds

### 📊 **Data & Analytics**
- **Artifact Management**: S3-compatible storage with metadata
- **Dataset Organization**: Hierarchical data structure
- **Export Capabilities**: Multiple format support
- **Logging System**: Comprehensive operation tracking
- **Performance Monitoring**: Real-time system metrics

## Technology Stack

### **Backend**
- **Framework**: FastAPI with Hypha-RPC communication
- **AI/ML**: Segment Anything Model (SAM), CLIP embeddings, vector similarity search
- **Data**: OME-Zarr format with zip endpoints, S3-compatible storage (MinIO)
- **Languages**: Python 3.11+
- **Key Libraries**: numpy, pillow, scikit-image, zarr, aiohttp, fastapi, torch, clip

### **Frontend** 
- **Framework**: React 18 with Vite build system
- **UI**: Bootstrap 5 + Tailwind CSS + CSS modules hybrid approach
- **Communication**: Hypha-RPC client
- **Key Libraries**: FontAwesome, WinBox, React Color, OpenLayers, Zarr/Zarrita

### **Infrastructure**
- **Containerization**: Docker with multi-service compose
- **CI/CD**: GitHub Actions with automatic Docker publishing
- **Deployment**: Hypha server platform with token-based authentication
- **Storage**: MinIO S3-compatible backend with artifact management
- **Testing**: pytest with asyncio support, Playwright for E2E testing

## Quick Start

1. **Try Online**: Visit [Agent-Lens Demo](https://hypha.aicell.io/agent-lens/apps/agent-lens-test/)

2. **Local Development**: 
   ```bash
   # Setup dependencies
   bash scripts/setup_dev.sh
   
   # Run in connect-server mode (recommended for testing)
   python -m agent_lens connect-server --workspace_name=agent-lens --server_url=https://hypha.aicell.io
   ```

3. **Access**: Open `https://hypha.aicell.io/agent-lens/apps/agent-lens-test/`

## Installation

### Prerequisites

- **System**: macOS, Linux, or Windows with WSL2
- **Software**: Docker, Conda, Node.js 16+, Python 3.11+

### Automatic Setup

```bash
# Clone repository
git clone https://github.com/your-org/agent-lens.git
cd agent-lens

# Run automated setup
bash scripts/setup_dev.sh
```

### Manual Installation

<details>
<summary>Click to expand manual installation steps</summary>

1. **Environment Setup**
   ```bash
   conda create -n agent-lens python=3.11
   conda activate agent-lens
   ```

2. **Python Dependencies**
   ```bash
   pip install -e ".[test]"
   ```

3. **Frontend Dependencies**
   ```bash
   npm install --prefix frontend
   ```

4. **Environment Variables**
   Create `.env` file:
   ```bash
   WORKSPACE_TOKEN=<your_agent_lens_token>
   PERSONAL_TOKEN=<your_personal_token>
   ```
   *Get tokens from [Hypha](https://hypha.aicell.io)*

5. **Start Services**
   ```bash
   # For testing (recommended)
   python -m agent_lens connect-server --workspace_name=agent-lens --server_url=https://hypha.aicell.io
   
   # Or for local development
   bash scripts/run_dev.sh
   ```

</details>

## Configuration

### Service Configuration

The application requires several backend services:

- **Microscope Control**: `agent-lens-squid-simulation`
- **AI Segmentation**: `interactive-segmentation` 
- **Similarity Search**: `similarity-search`
- **Orchestrator**: Task scheduling and workflow management

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `WORKSPACE_TOKEN` | Agent-Lens workspace token | Yes |
| `PERSONAL_TOKEN` | Personal workspace token | Yes |
| `SERVER_URL` | Hypha server URL | No |
| `LOG_LEVEL` | Logging level (DEBUG/INFO/WARN) | No |

## Project Structure

```
agent-lens/
├── 📁 agent_lens/              # Python backend package
│   ├── 📁 utils/               # Utility modules (artifact manager, similarity search)
│   ├── 📄 register_frontend_service.py  # Frontend ASGI service registration
│   └── 📄 __main__.py          # CLI entry point
├── 📁 frontend/                # React application
│   ├── 📁 components/          # UI components
│   │   ├── 📁 annotation/      # Image annotation system
│   │   ├── 📁 microscope/      # Microscope control and visualization
│   │   └── 📄 *.jsx            # Control panels, modals, settings
│   ├── 📁 utils/               # Frontend utilities (Zarr loader, embeddings)
│   ├── 📄 main.jsx             # Root React component
│   └── 📄 package.json         # Frontend dependencies
├── 📁 tests/                   # Test suite (project root level)
│   ├── 📁 test-frontend-components/  # Frontend component tests
│   └── 📄 test_*.py/js         # Python and JavaScript tests
├── 📁 docker/                  # Containerization configs
├── 📁 scripts/                 # Development and deployment scripts
└── 📄 pyproject.toml           # Python project configuration
```

## Core Components

### **Microscope Control Interface**
- Real-time hardware control with safety mechanisms
- Multi-axis positioning and automated movements
- Channel management and illumination control

### **Microscope Stage Map**
- **Interactive Stage Map**: Visualize the entire microscope stage with pan and zoom controls.
- **Well Plate Overlay**: See 96, 48, or 24-well plate layouts directly on the map.
- **Scan Area Selection**: Click and drag to select scan regions within wells, with visual feedback.
- **Multi-Well Support**: Select multiple wells for batch scanning or time-lapse imaging.
- **Live Video Integration**: See the current field of view (FOV) and live video position on the map.
- **Scan Results Overlay**: View stitched scan results with channel selection and layer controls.
- **Experiment Management**: Organize scan data by experiment, with per-well canvases and metadata.

The stage map is integrated into the main control panel, providing a seamless experience for both real and simulated microscopes, supporting advanced workflows like multi-well scanning and experiment-based data management.

### **AI Segmentation Engine**
- Multiple model support (SAM, custom models)
- Interactive and batch processing modes
- Vector embedding generation and management

### **Data Analysis Pipeline**
- High-performance data processing with Zarrita
- Multi-format support (uint8, uint16)
- Real-time data access and processing

### **Hardware Orchestration**
- Sample handling workflow automation
- Multi-device coordination and scheduling
- Error recovery and rollback procedures

## Development

### Development Workflow

1. **Start Development Server**
   ```bash
   # For testing with connect-server (recommended)
   python -m agent_lens connect-server --workspace_name=agent-lens --server_url=https://hypha.aicell.io
   
   # Or for local development
   bash scripts/run_dev.sh
   ```

2. **Run Tests**
   ```bash
   # Quick development testing
   python scripts/run_tests.py --type fast
   
   # Run with coverage
   python scripts/run_tests.py --coverage
   
   # Run all tests including AI models
   python scripts/run_tests.py --type slow
   ```

3. **Build for Production**
   ```bash
   docker-compose -f docker/docker-compose.yml build
   ```

### Testing Infrastructure

Agent-Lens has a comprehensive testing setup with:

- **✅ Multiple test suites** covering core functionality
- **Vector similarity testing** with CLIP and FAISS
- **Async microscopy simulation** with mock hardware
- **Frontend service testing** with Playwright E2E testing
- **Frontend component testing** with vanilla JavaScript test runners
- **CI/CD integration** with GitHub Actions

**Test Categories:**
- `--type fast`: Unit tests (< 2 seconds, recommended for development)
- `--type integration`: Service integration tests  
- `--type slow`: AI models and large datasets
- `--frontend-service`: Frontend service tests with Playwright
- `--coverage`: Generate coverage reports

**Test Execution:**
```bash
# Quick development testing
python scripts/run_tests.py --type fast

# Run with coverage
python scripts/run_tests.py --coverage

# Run all tests including AI models
python scripts/run_tests.py --type slow

# Frontend service tests
python scripts/run_tests.py --frontend-service
```

### Code Standards

- **Python**: PEP 8, async/await patterns, type hints
- **JavaScript**: ES6+, functional components, PropTypes
- **Testing**: pytest for backend, React Testing Library for frontend
- **AI Testing**: CLIP/FAISS similarity search, vector embeddings
- **Documentation**: Comprehensive docstrings and comments

## Contributing

We welcome contributions! Please see our [Contributing Guidelines](CONTRIBUTING.md) for details on:

- Code of conduct
- Development process
- Pull request procedures
- Issue reporting

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

TBD