#!/bin/bash

# Create and activate conda environment
echo "Creating and activating conda environment..."
conda create -n agent-lens python=3.10.13 -y
source activate agent-lens

# Install Python dependencies
echo "Installing Python dependencies..."
pip install -r requirements_test.txt
pip install -e .

# Prompt user for secret tokens
read -sp "Enter your agent-lens workspace token: " WORKSPACE_TOKEN
echo
read -sp "Enter your personal workspace token: " PERSONAL_TOKEN
echo

# Create .env file with environment variables
echo "Creating .env file..."
cat <<EOT > agent_lens/.env
WORKSPACE_TOKEN=$WORKSPACE_TOKEN
PERSONAL_TOKEN=$PERSONAL_TOKEN
EOT

# Install npm dependencies
echo "Installing npm dependencies..."
npm install --prefix frontend

echo "Setup complete!"