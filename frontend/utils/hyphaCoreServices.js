/**
 * Hypha Core Services
 * Copied and adapted from hypha-agents/src/components/services/hyphaCoreServices.ts
 */

import { inspectImages } from './visionInspection';
import OpenAI from 'openai';

/**
 * Setup notebook service - registers the API service and connects it in Python kernel
 * Based on hypha-agents setupNotebookService pattern
 * 
 * @param {Object} options - Setup options
 * @param {Object} options.server - Hypha server instance
 * @param {Function} options.executeCode - Function to execute Python code in kernel
 * @param {Object} options.agentSettings - Agent settings (apiKey, baseURL, model)
 * @returns {Promise<Object>} - The registered service API
 */
export const setupNotebookService = async ({
  server,
  executeCode,
  agentSettings,
}) => {
  console.log("Setting up notebook service with agent settings:", agentSettings);
  
  try {
    const service = {
      "id": "hypha-core",
      "name": "Hypha Core",
      "description": "Hypha Core service",
      "config": {
        "require_context": false,
      },
      inspectImages: async (options) => {
        const { images, query, contextDescription, outputSchema } = options;
        
        // Check if model supports vision
        const isVisionModel = /gpt-[45]|llava/i.test(agentSettings.model);
        if (!isVisionModel) {
          return `Error: Model '${agentSettings.model}' does not support vision capabilities. Please use a vision-capable model like gpt-4o, gpt-4-vision, or llava.`;
        }

        console.log("inspectImages called with outputSchema:", !!outputSchema);
        if (outputSchema) {
          console.log("outputSchema keys:", Object.keys(outputSchema));
        }

        try {
          const result = await inspectImages({
            images,
            query,
            contextDescription,
            model: agentSettings.model,
            baseURL: agentSettings.baseURL,
            apiKey: agentSettings.apiKey,
            outputSchema: outputSchema,
          });
          
          console.log("inspectImages result type:", typeof result);
          console.log("inspectImages result:", result);
          
          return result;
        } catch (error) {
          console.error("Error in inspectImages wrapper:", error);
          throw error;
        }
      },
      chatCompletion: async (options) => {
        const { messages, max_tokens = 1024, response_format } = options;

        const openai = new OpenAI({
          apiKey: agentSettings.apiKey,
          baseURL: agentSettings.baseURL,
          dangerouslyAllowBrowser: true
        });

        const completionParams = {
          model: agentSettings.model,
          messages: messages,
          max_tokens: max_tokens,
          stream: false,
        };

        // Conditionally add the response_format
        if (response_format) {
          if (response_format.type === 'json_schema') {
            completionParams.response_format = {
              type: 'json_schema',
              json_schema: response_format.json_schema
            };
          } else {
            completionParams.response_format = { type: response_format.type };
          }
        }

        try {
          const response = await openai.chat.completions.create(completionParams);
          const content = response.choices[0]?.message?.content || "No response generated";

          // Parse JSON if response_format is json_object or json_schema
          if (response_format && (response_format.type === 'json_object' || response_format.type === 'json_schema')) {
            try {
              return JSON.parse(content);
            } catch (parseError) {
              console.error("Failed to parse JSON response:", parseError);
              throw new Error(`Error parsing JSON response: ${content}`);
            }
          }

          return content;
        } catch (error) {
          console.error("Error in chat completion:", error);
          const errorMessage = error instanceof Error ? error.message : String(error);
          return `Error during chat completion: ${errorMessage}`;
        }
      },
    };

    // Register service with Hypha server
    const svc = await server.registerService(service);
    console.log(`Notebook service registered with id ${svc.id}`);
    
    const token = await server.generateToken();
    await executeCode(`import micropip
await micropip.install(['numpy', 'nbformat', 'pandas', 'matplotlib', 'plotly', 'hypha-rpc', 'pyodide-http'])
import pyodide_http
pyodide_http.patch_all()
%matplotlib inline

from hypha_rpc import connect_to_server
server = await connect_to_server(server_url="${server.config.public_base_url}", token="${token}")
api = await server.get_service("${svc.id}")
print("Hypha Core service connected in kernel.")

# Set environment variables
import os
os.environ['CURRENT_URL'] = '${window.location.href}'
os.environ['HYPHA_SERVER_URL'] = '${server.config.public_base_url}'
os.environ['HYPHA_WORKSPACE'] = '${server.config.workspace}'
os.environ['HYPHA_TOKEN'] = '${token}'
print("Environment variables set successfully.")
    `, {
      onOutput: (output) => {
        if (output && output.type === 'stderr') {
          console.error("[Notebook] Error:", output.content);
        } else if (output && output.type === 'stdout') {
          console.log("[Notebook] Stdout:", output.content);
        } else {
          console.log("[Notebook] Output:", output);
        }
      },
      onStatus: (status) => {
        console.log("[Notebook] Status:", status);
      }
    });

    return service;
  } catch (error) {
    throw error;
  }
};

