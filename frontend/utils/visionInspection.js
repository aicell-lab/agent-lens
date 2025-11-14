/**
 * Vision Inspection utilities
 * Copied from hypha-agents/src/utils/visionInspection.ts
 */

import OpenAI from 'openai';

/**
 * Inspects images using GPT-4 Vision model.
 * This function is designed to work in the browser environment.
 * 
 * @param {Object} options - Configuration options for the vision inspection
 * @param {Array} options.images - Array of image objects with url property
 * @param {string} options.query - Question about the images
 * @param {string} options.contextDescription - Context for the images
 * @param {string} [options.model='gpt-4o-mini'] - Model to use
 * @param {number} [options.maxTokens=1024] - Maximum tokens in response
 * @param {string} options.baseURL - Base URL for OpenAI API
 * @param {string} options.apiKey - OpenAI API key
 * @param {Object} [options.outputSchema] - Optional JSON schema for structured output
 * @returns {Promise<string|Object>} - Model's response (string or parsed JSON if schema provided)
 */
export async function inspectImages({
  images,
  query,
  contextDescription,
  model = "gpt-4o-mini",
  maxTokens = 1024,
  baseURL,
  apiKey,
  outputSchema
}) {

  // Validate image URLs
  for (const image of images) {
    if (!image.url.startsWith('http://') && !image.url.startsWith('https://') && !image.url.startsWith('data:')) {
      throw new Error(`Invalid image URL format: ${image.url}. URL must start with http://, https://, or data:.`);
    }
  }

  const openai = new OpenAI({
    apiKey: apiKey,
    baseURL: baseURL,
    dangerouslyAllowBrowser: true
  });

  // Build the content array for the user message conditionally
  const userContentParts = [];

  if (contextDescription && typeof contextDescription === 'string' && contextDescription.trim() !== '') {
    userContentParts.push({ type: "text", text: contextDescription });
  }

  if (query && typeof query === 'string' && query.trim() !== '') {
    userContentParts.push({ type: "text", text: query });
  }

  userContentParts.push(...images.map(image => ({
    type: "image_url",
    image_url: {
      url: image.url,
    }
  })));

  const messages = [
    {
      role: "system",
      content: "You are a helpful AI assistant that helps users inspect the provided images visually based on the context, make insightful comments and answer questions about the provided images."
    },
    {
      role: "user",
      content: userContentParts
    }
  ];

  try {
    // Conditionally add response_format based on outputSchema
    const completionParams = {
      model: model,
      messages: messages,
      max_tokens: maxTokens,
    };

    if (outputSchema && typeof outputSchema === 'object' && Object.keys(outputSchema).length > 0) {
      // Set response format to json_schema
      const schema = { ...outputSchema };
      if (!('additionalProperties' in schema)) {
        schema.additionalProperties = false;
      }
      completionParams.response_format = { 
        type: "json_schema", 
        json_schema: { 
          schema: schema,
          name: "outputSchema", 
          strict: true 
        } 
      };
    }

    const response = await openai.chat.completions.create(completionParams);
    
    const content = response.choices[0].message.content || "No response generated";
    
    // if outputSchema is provided, parse the response using JSON.parse with error handling
    if (outputSchema && typeof outputSchema === 'object' && Object.keys(outputSchema).length > 0) {
      console.log("visionInspection: outputSchema detected, attempting to parse JSON");
      console.log("visionInspection: raw content:", content);
      try {
        const parsed = JSON.parse(content);
        console.log("visionInspection: successfully parsed JSON:", typeof parsed, parsed);
        return parsed;
      } catch (parseError) {
        console.error("Failed to parse JSON response from vision inspection:", parseError);
        console.error("Raw response content:", content);
        throw new Error(`Error parsing JSON response: ${content}`);
      }
    }
    
    return content;
  } catch (error) {
    console.error("Error in vision inspection:", error);
    throw error;
  }
}

/**
 * Converts a File or Blob to a base64 data URL.
 * 
 * @param {File|Blob} file - The file or blob to convert
 * @returns {Promise<string>} - Promise resolving to the base64 data URL
 */
export async function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('Failed to convert file to data URL'));
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * Converts a base64 string to a data URL with the correct MIME type.
 * 
 * @param {string} base64 - The base64 string
 * @param {string} mimeType - The MIME type of the image
 * @returns {string} - The complete data URL
 */
export function base64ToDataUrl(base64, mimeType) {
  return `data:${mimeType};base64,${base64}`;
}

