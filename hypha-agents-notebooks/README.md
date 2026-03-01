# Agent-Lens Hypha Agents Notebooks

Interactive AI microscopy demo notebooks running in-browser via [Hypha Agents](https://github.com/aicell-lab/hypha-agents).

## Getting Started

1. Go to [https://agents.aicell.io/](https://agents.aicell.io/) and click **Agent Lab**
2. Click the **Manual** button (top-left), then select **In-Browser Project**
3. Upload the notebook file (e.g. `agent-lens-hpa-demo-20260301.ipynb`)

## Setting the Workspace Token

The notebook requires a `workspace_token` to connect to the Agent-Lens Hypha server:

1. Inside the notebook, click **Settings** → **Environment Variables**
2. Add a variable with:
   - **Name**: `workspace_token`
   - **Value**: your Agent-Lens workspace token

## Running the Notebook

Once the token is set, run the cells to start a conversation with the AI agent. The demo will:

- Connect to the Agent-Lens microscopy services
- Control a simulated HPA (Human Protein Atlas) microscope
- Acquire and segment fluorescence images
- Perform cell similarity search using vector embeddings

## Notebooks

| File | Description |
|------|-------------|
| `agent-lens-hpa-demo-20260301.ipynb` | HPA plate simulation demo — multi-channel imaging, cell segmentation, and similarity search |
