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

### Prerequisites

1. **Clone the repository:**

   ```bash
   git clone https://github.com/yourusername/agent-lens.git
   ```

2. **Navigate to the project directory:**

   ```bash
   cd agent-lens
   ```

### Backend installation

1. **Conda environment:**

   ```bash
   conda create -n agent-lens python=3.10.13
   conda activate agent-lens
   ```

2. **Install dependencies:**

    ```bash
    pip install -r requirements.txt
    pip install -e .
    ```

### Frontend installation

1. **Install dependencies:**

   ```bash
   npm install
   ```

## Usage

## Step 1: Generate Image Tiles from Your Large Image

To efficiently display large images in web applications, it's common to break them into smaller tiles. This allows the application to load only the necessary tiles based on the user's viewport and zoom level, improving performance.

#### 1. Install VIPS

- **On Ubuntu/Debian:**

  ```bash
  sudo apt-get install libvips-tools
  ```

- **On macOS using Homebrew:**

  ```bash
  brew install vips
  ```

#### 2. Generate Tiles

Replace `your_large_image.jpg` with the path to your large image file.

```bash
vips dzsave your_large_image.jpg tiles_output_directory --layout google
```

- `--layout google`: Generates tiles in XYZ format compatible with OpenLayers.

**Example:**

```bash
vips dzsave large_image.jpg tiles --layout google
```

This command will generate tiles in the `tiles` directory.

## Step 2: Set Up a Local Tile Server

Once you have generated the tiles, you need to serve them over HTTP so that your application can access them.

### Option 1: Using Python's Built-in HTTP Server

If you have Python installed, you can use its built-in HTTP server.

#### For Python 3:

```bash
cd tiles_output_directory
python3 -m http.server 8000
```

#### For Python 2:

```bash
cd tiles_output_directory
python -m SimpleHTTPServer 8000
```

This will start a local HTTP server at `http://localhost:8000/`.


#### 2. Start the Server

```bash
cd tiles_output_directory
http-server -p 8000
```

This will start a local HTTP server at `http://localhost:8000/`.

---

**Note:** Ensure that the port number (`8000` in these examples) does not conflict with any other services running on your machine.

You can now access your tiles via the local server. Ensure that your OpenLayers application is configured to load tiles from `http://localhost:8000/{z}/{x}/{y}.png` (or `.jpeg` if you generated JPEG tiles).

---

### Start the Development Server

```bash
npm run start
```

This will start the application at [http://localhost:5173](http://localhost:5173) (default Vite port).

### Build for Production

```bash
npm run build
```

### Preview the Production Build

```bash
npm run serve
```

## Configuration

- **Microscope Control Service**: Ensure that the microscope control backend service (`microscope-control-squid-test`) is running and accessible.
- **Segmentation Service**: The application connects to an AI segmentation service (`interactive-segmentation`) for image analysis.
- **Similarity Search Service**: The application uses the `image-embedding-similarity-search` service to find similar images.

## Project Structure

```
agent-lens/
├── index.html
├── node_modules/
├── package.json
├── README.md
├── src/
│   ├── main.jsx
│   └── style.css
├── scripts/
│   ├── embed-image-vectors.py
│   ├── rebuild_cell_db_512.py
│   ├── register-sam-service.py
│   └── register-similarity-search-service.py
├── test/
│   └── test_sam_service.py
├── tiles_output/
└── vite.config.mjs
```

- **index.html**: The main HTML file where the React app is rendered.
- **main.jsx**: The main JavaScript file containing the React code, including the `MicroscopeControl` component.
- **style.css**: Contains all the CSS styles for the application.
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
