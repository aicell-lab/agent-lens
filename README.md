# Agent-Lens: Smart Microscopy Web Application

## Introduction

**Agent-Lens** is a web application designed for controlling a microscope and performing advanced image analysis tasks such as segmentation and similarity search. Developed using React, OpenLayers, and Bootstrap, this project provides an intuitive and efficient user interface for microscopy image capture, control, and analysis.

## Features

- **Microscope Control**: Interface with microscope hardware to control illumination intensity, channel selection, camera exposure, and movement along X, Y, and Z axes.
- **Image Capture**: Capture images with adjustable settings using a simulated function that currently returns a placeholder image.
- **Image Display**: View captured images with pan and zoom capabilities using OpenLayers.
- **Image Tagging and Storage**: Tag and store images temporarily in the browser for later retrieval.
- **Segmentation Tools**:
  - **Interactive Segmentation**: Use the pen tool to segment individual cells or objects in the image.
  - **Automatic Segmentation**: Automatically segment all cells in the image using AI-powered services.
  - **Reset Segmentation**: Reset embeddings to start a new segmentation process.
- **Annotation Tools**:
  - **Add Points**: Place point annotations on the image.
  - **Add Polygons**: Draw polygon annotations on the image.
- **Similarity Search**: Search for similar images based on the captured image data.
- **Chatbot Integration**: Open a chatbot window for assistance or automated tasks.
- **Logging**: View logs of actions and system messages for troubleshooting and record-keeping.

## Technology Stack

- **React**: A JavaScript library for building user interfaces.
- **OpenLayers**: A high-performance library for displaying map data, used here for image manipulation.
- **Bootstrap**: A CSS framework for designing responsive web interfaces.
- **FontAwesome**: Provides a rich set of icons for UI components.
- **Hypha-RPC**: Enables remote procedure calls to interact with backend services.
- **WinBox**: A modern HTML5 window manager for pop-up dialogs and chat windows.
- **Vite**: A build tool that provides a faster and leaner development experience for modern web projects.

## Installation

### Automatic Installation

Run the following command to install the application and its dependencies automatically:

  ```bash
  bash scripts/install.sh
  ```

### Manual Installation

If you prefer to set up the application manually, follow the steps below:

1. **Conda environment:**
   ```bash
  conda create -n agent-lens python=3.10.13
  conda activate agent-lens
   ```

2. **Install Python dependencies:**
    ```bash
    pip install -r requirements.txt
    pip install -e .
    ```

3. **Add the following environment variables to a `.env` file:**

    ```bash
    WORKSPACE_TOKEN=<agent-lens_workspace_token>
    PERSONAL_TOKEN=<personal_workspace_token>
    ```

  You can get the `agent-lens_workspace_token` and `personal_workspace_token` from [Hypha](https://hypha.aicell.io). The `JWT_SECRET` can be any integer, e.g. `1337`.

4. **Install npm dependencies:**
    ```bash
    npm install --prefix agent-lens/frontend
    ```

### Running the Application

1. **Start application in VSCode:**

  Go to "Run and Debug" and select "Python: start-server" as the debug configuration. Press run.

2. **Access the application:**

  Open the browser and navigate to `http://localhost:8080/public/apps/microscope-control`.

## Configuration

- **Microscope Control Service**: Ensure that the microscope control backend service (`microscope-control-squid-test`) is running and accessible.
- **Segmentation Service**: The application connects to an AI segmentation service (`interactive-segmentation`) for image analysis.
- **Similarity Search Service**: The application uses the `image-embedding-similarity-search` service to find similar images.

## Project Structure

```
agent-lens/
├── agent_lens/
│   ├── test/
│   │   └── test_sam_service.py
│   ├── artifact_manager.py
│   ├── main.py
│   ├── register_frontend_service.py
│   ├── register_sam_service.py
│   ├── register_similarity_search_service.py
│   ├── service_utils.py
│   └── start_server.py
├── frontend/
│   ├── index.html
│   ├── main.jsx
│   ├── package.json
│   └── vite.config.mjs
├── .env
├── .gitignore
├── pyproject.toml
├── README.md
└── requirements.txt
```

- **index.html**: The main HTML file where the React app is rendered.
- **main.jsx**: The main JavaScript file containing the React code, including the `MicroscopeControl` component.
- **tiles_output/**: Directory containing image tiles used by OpenLayers.
- **vite.config.mjs**: Configuration file for Vite.

## Key Dependencies

- **React** (`react`, `react-dom`): Core library for building the user interface.
- **OpenLayers** (`ol`): For image display and interaction.
- **Bootstrap**: For responsive and modern UI components.
- **FontAwesome**: Icon library for enhancing the UI.
- **Hypha-RPC**: Facilitates communication with backend services.
- **WinBox**: For managing additional windows like the chatbot.
- **Vite**: Development server and build tool.

## Features in Detail

### Microscope Control

- **Illumination Settings**:
  - Adjust illumination intensity and select different illumination channels (e.g., Bright Field, Fluorescence channels).
  - Control camera exposure time.
- **Movement Controls**:
  - Move the microscope stage along X, Y, and Z axes.
  - Autofocus functionality.
- **Light Controls**:
  - Toggle the microscope light on or off.

### Image Display and Interaction

- **OpenLayers Integration**:
  - Display high-resolution images with zoom and pan capabilities.
  - Overlay segmentation masks and annotations.
- **Annotation Tools**:
  - **Add Point**: Place markers on specific points of interest.
  - **Add Polygon**: Draw polygons to outline areas of interest.

### Segmentation and Analysis

- **Interactive Segmentation**:
  - Use the pen tool to click on the image and segment individual cells or objects.
  - Supports multiple models like `vit_b_lm`, `vit_l_lm`, etc.
- **Automatic Segmentation**:
  - Segment all cells in the image automatically using AI services.
- **Similarity Search**:
  - Search for similar images based on the current image.

### BioImageChat Integration

- Open a BioImage-chatbot window to assist with tasks or provide information.

### Logging

- View detailed logs of all actions performed within the application for monitoring and debugging purposes.

## Styling

- The application uses modern CSS styling techniques, including flexbox and responsive design principles.
- Buttons and controls are styled for a consistent and intuitive user experience.

## License

TBD.

## Acknowledgments

- TBD.

---
