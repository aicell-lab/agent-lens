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
- **Illumination Management**: Support for multiple channels (BF, F405, F488, F561, F638, F730)
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
- **High-resolution Display**: OpenLayers-based pan/zoom interface
- **Annotation Tools**: Points, polygons, and custom markers
- **Data Management**: Zarr-based efficient storage and retrieval

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
- **AI/ML**: Segment Anything Model (SAM), vector embeddings
- **Data**: Zarr format, S3-compatible storage
- **Languages**: Python 3.11+

### **Frontend** 
- **Framework**: React 18 with Vite
- **Visualization**: OpenLayers for high-performance imaging
- **UI**: Bootstrap 5 + Tailwind CSS
- **Communication**: Hypha-RPC client

### **Infrastructure**
- **Containerization**: Docker with multi-service compose
- **CI/CD**: GitHub Actions
- **Deployment**: Hypha server platform
- **Storage**: MinIO S3-compatible backend

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
   pip install -r requirements.txt
   pip install -e .
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
│   ├── 📁 tests/               # Test suite
│   ├── 📄 artifact_manager.py  # Data storage management
│   ├── 📄 register_*.py        # Service registration modules
│   └── 📄 __main__.py          # CLI entry point
├── 📁 frontend/                # React application
│   ├── 📁 components/          # Reusable UI components
│   ├── 📄 main.jsx             # Root component
│   ├── 📄 utils.jsx            # Utility functions
│   └── 📄 main.css             # Global styles
├── 📁 docker/                  # Containerization
│   ├── 📄 docker-compose.yml   # Service orchestration
│   └── 📄 dockerfile           # Application container
├── 📁 scripts/                 # Development scripts
├── 📁 docs/                    # Documentation
└── 📄 requirements.txt         # Python dependencies
```

## Core Components

### **Microscope Control Interface**
- Real-time hardware control with safety mechanisms
- Multi-axis positioning and automated movements
- Channel management and illumination control

### **AI Segmentation Engine**
- Multiple model support (SAM, custom models)
- Interactive and batch processing modes
- Vector embedding generation and management

### **Image Analysis Pipeline**
- High-performance tile-based rendering
- Multi-format support (uint8, uint16)
- Real-time contrast and brightness adjustment

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
   pytest agent_lens/tests/
   ```

3. **Build for Production**
   ```bash
   docker-compose -f docker/docker-compose.yml build
   ```

### Code Standards

- **Python**: PEP 8, async/await patterns, type hints
- **JavaScript**: ES6+, functional components, PropTypes
- **Testing**: pytest for backend, React Testing Library for frontend
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

- **Hypha Team**: For the RPC framework and platform
- **OpenLayers Community**: For the mapping and visualization library
- **SAM Team**: For the Segment Anything model
- **Research Community**: For feedback and use cases

---

<p align="center">
  <strong>Built with ❤️ for the microscopy research community</strong>
</p>
