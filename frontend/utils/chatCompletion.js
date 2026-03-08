/**
 * Chat Completion utility for Agent Panel
 * Uses OpenAI tool calling (runCode + commitCodeBlocks) instead of XML tags
 */

import OpenAI from 'openai';
import { modelSupportsTemperature } from './openaiConfig';

/**
 * Generate a unique ID
 */
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * Response instructions for the AI agent (tool calling version)
 */
const RESPONSE_INSTRUCTIONS = `
You are a powerful coding assistant capable of solving complex tasks by writing and executing Python code while controlling laboratory hardware.
You will be given a task and must methodically analyze, plan, and execute Python code to achieve the goal.

**FUNDAMENTAL REQUIREMENT: ALWAYS USE CODE AND TOOLS**
- Never provide purely text-based responses without code execution
- Every task must involve writing and executing Python code, except for simple questions
- Use the runCode tool to execute Python code
- Use available services and APIs to gather information and solve problems
- If you need to explain something, demonstrate it with code examples
- If you need to research something, write code to search or analyze data
- Transform theoretical knowledge into practical, executable solutions

## Core Execution Cycle

Follow this structured approach for every task:

### 1. **Code Execution with runCode Tool**
Use the runCode tool to execute Python code. The tool accepts:
- **code** (required): The Python code to execute as a string
- **script_id** (optional): A unique identifier for this code block for reference

**Environment**: Code runs in a Pyodide-based Jupyter notebook in the browser:
- ✅ Use **top-level await** directly: \`result = await some_async_function()\`
- ❌ Don't use \`asyncio.run()\` - it's not needed and won't work correctly
- All state (variables, imports) persists between executions
- Matplotlib/Plotly plots display automatically

Always include in your code:
- Clear, well-commented code
- **Essential: Use \`print()\` statements** to output results, variables, and progress updates
- Only printed output becomes available in subsequent observations
- Error handling where appropriate

### 2. **Observation Analysis**
After each code execution, you'll receive the output from the tool. Use this to:
- Verify your code worked as expected
- Understand the data or results
- Plan your next step based on what you learned

### 3. **Committing Code Blocks**
**CRITICAL**: Code blocks are staged by default and will NOT be visible to the user or included in future conversations unless you commit them.

- Use the **commitCodeBlocks** tool to commit working code when ready
- **ALWAYS commit your final working code** before finishing the conversation
- Only commit code that works correctly - don't commit failed attempts or intermediate iterations
- Uncommitted code blocks will be hidden from the user and excluded from conversation history

Example workflow:
1. Try approach with runCode (script_id="attempt1") - doesn't work, don't commit
2. Fix the issue with runCode (script_id="attempt2") - works! Commit this one
3. Call commitCodeBlocks with code_block_ids=["attempt2"] and a message

### 4. **Final Response**
When you have completed the task:
- **Always call commitCodeBlocks** to commit your working code
- The message in commitCodeBlocks serves as your final response to the user
- Summarize what was accomplished
- List which code blocks were committed and why

**IMPORTANT**: If you don't commit code blocks, they will be hidden and the user won't see your work!

## Advanced Capabilities

### Service Integration
You have access to Hypha services through the kernel environment. These services are automatically available as functions:
- Use them directly like any Python function
- Services handle complex operations like hardware control, image processing, etc.
- Always print() the results to see outputs in observations

### Data Visualization
For plots and charts:
- Use matplotlib, plotly, or seaborn
- **Plots are automatically displayed inline** - just create them, no need to call \`.show()\` or save
- Example with matplotlib:
  \`\`\`python
  import matplotlib.pyplot as plt
  plt.plot([1, 2, 3], [4, 5, 6])
  plt.title("My Plot")
  # Plot appears automatically, no plt.show() needed!
  \`\`\`

## Key Requirements

### Code Quality
- Write clean, readable code with comments
- Use appropriate error handling
- Follow Python best practices
- Import only what you need

### Output Management
- **Critical: Use print() for any data you need to reference later**
- Print intermediate results, not just final answers
- Include context in your print statements
- For large outputs, print summaries or key excerpts

### State Management
- **Jupyter Notebook State**: All variables and imports persist between code executions
- Build on previous results rather than re-computing
- Use descriptive variable names for clarity
- You can reference variables from previous code blocks

### Problem Solving
- If you encounter errors, analyze the output and adapt
- Try alternative approaches when initial attempts fail
- Break complex problems into smaller, manageable steps
- Don't give up - iterate until you find a solution

## Runtime Environment

**IMPORTANT**: You are running in a **Pyodide-based Jupyter notebook environment** in the user's browser.

- **Platform**: Pyodide (Python in WebAssembly) running in the browser
- **Top-Level Await**: You can use \`await\` directly at the top level - **NO need for \`asyncio.run()\`**
- **State Persistence**: All variables, imports, and data persist between code executions
- **Package Management**: Use \`import micropip; await micropip.install('package-name')\`
- **Standard Libraries**: Most Python standard library modules are available
- **Network**: HTTP requests available through patched requests library

## Error Recovery

When things go wrong:
1. Read the error message carefully
2. Identify the specific issue (syntax, logic, missing dependency, etc.)
3. Adapt your approach in the next runCode call
4. Use print() to debug and understand the state
5. Try simpler approaches if complex ones fail

Remember: Every piece of information you need for subsequent steps must be explicitly printed.
`;

// Define the runCode tool schema for OpenAI tool calling
const RUN_CODE_TOOL = {
  type: "function",
  function: {
    name: "runCode",
    description: "Execute Python code in the Pyodide environment. Use this tool to run any Python code that helps accomplish the task. The code execution environment persists between calls, so variables and imports are maintained.",
    parameters: {
      type: "object",
      properties: {
        code: {
          type: "string",
          description: "The Python code to execute. Include print() statements to output results that you need to reference later."
        },
        script_id: {
          type: "string",
          description: "Optional unique identifier for this code block for reference purposes"
        }
      },
      required: ["code"]
    }
  }
};

// Define the commitCodeBlocks tool schema
const COMMIT_CODE_BLOCKS_TOOL = {
  type: "function",
  function: {
    name: "commitCodeBlocks",
    description: "Commit specific code blocks to make them permanent and visible to the user. Only committed code blocks will be included in future conversation context. Use this when you have working code that should be preserved. Always commit your final working code before finishing.",
    parameters: {
      type: "object",
      properties: {
        code_block_ids: {
          type: "array",
          items: {
            type: "string"
          },
          description: "Array of script_id values from runCode calls that should be committed (made permanent and visible)"
        }
      },
      required: ["code_block_ids"]
    }
  }
};

/**
 * Chat completion generator using OpenAI tool calling
 * @param {Object} options - Chat completion options
 * @returns {AsyncGenerator} - Yields chat completion events
 */
export async function* chatCompletion({
  messages,
  systemPrompt = '',
  model = 'gpt-4o-mini',
  temperature = 1,
  onExecuteCode,
  onMessage,
  onStreaming,
  maxSteps = 15,
  baseURL,
  apiKey,
  stream = true,
  abortController
}) {
  try {
    const controller = abortController || new AbortController();
    const { signal } = controller;

    // Build system prompt: instructions first, then domain context
    systemPrompt = RESPONSE_INSTRUCTIONS + (systemPrompt ? `\n\n${systemPrompt}` : '');

    const openai = new OpenAI({
      baseURL,
      apiKey,
      dangerouslyAllowBrowser: true
    });

    let loopCount = 0;

    while (loopCount < maxSteps) {
      if (signal.aborted) {
        console.log('[ChatCompletion] Aborted by user');
        return;
      }

      loopCount++;
      const fullMessages = systemPrompt
        ? [{ role: 'system', content: systemPrompt }, ...messages]
        : messages;
      const completionId = generateId();

      console.log('[ChatCompletion] New completion:', completionId);

      yield {
        type: 'new_completion',
        completion_id: completionId
      };

      let accumulatedResponse = '';
      let accumulatedToolCalls = [];

      try {
        const requestParams = {
          model,
          messages: fullMessages,
          stream,
          tools: [RUN_CODE_TOOL, COMMIT_CODE_BLOCKS_TOOL]
        };

        if (modelSupportsTemperature(model)) {
          requestParams.temperature = temperature;
        }

        const completionStream = await openai.chat.completions.create(
          requestParams,
          { signal }
        );

        try {
          for await (const chunk of completionStream) {
            if (signal.aborted) {
              console.log('[ChatCompletion] Stream aborted by user');
              return;
            }

            const delta = chunk.choices[0]?.delta;
            let hasContentUpdate = false;

            // Accumulate text content
            if (delta?.content) {
              accumulatedResponse += delta.content;
              hasContentUpdate = true;

              if (onStreaming) {
                onStreaming(completionId, accumulatedResponse);
              }
              yield { type: 'text', content: accumulatedResponse };
            }

            // Accumulate tool calls
            if (delta?.tool_calls) {
              for (const toolCall of delta.tool_calls) {
                const index = toolCall.index;

                if (!accumulatedToolCalls[index]) {
                  accumulatedToolCalls[index] = {
                    id: toolCall.id || '',
                    type: toolCall.type || 'function',
                    function: { name: toolCall.function?.name || '', arguments: '' }
                  };
                }

                if (toolCall.function?.name) {
                  accumulatedToolCalls[index].function.name = toolCall.function.name;
                }
                if (toolCall.function?.arguments) {
                  accumulatedToolCalls[index].function.arguments += toolCall.function.arguments;
                }
                if (toolCall.id) {
                  accumulatedToolCalls[index].id = toolCall.id;
                }
              }

              // Stream partial code from runCode tool calls as markdown
              if (accumulatedToolCalls.length > 0 && !hasContentUpdate) {
                let streamingContent = accumulatedResponse || '';

                for (const tc of accumulatedToolCalls) {
                  if (tc && tc.function.name === 'runCode') {
                    try {
                      const args = tc.function.arguments;
                      if (args && args.length > 0) {
                        const codeMatch = args.match(/"code"\s*:\s*"((?:[^"\\]|\\[\s\S])*)(?:"|$)/);
                        if (codeMatch) {
                          const code = codeMatch[1]
                            .replace(/\\n/g, '\n')
                            .replace(/\\t/g, '\t')
                            .replace(/\\r/g, '\r')
                            .replace(/\\"/g, '"')
                            .replace(/\\0/g, '')
                            .replace(/\\u0000/g, '')
                            .replace(/\\\\/g, '\\');

                          if (streamingContent && !streamingContent.endsWith('\n\n')) {
                            streamingContent += '\n\n';
                          }
                          streamingContent += `\`\`\`python\n${code}\n\`\`\``;
                        }
                      }
                    } catch (e) {
                      console.debug('[ChatCompletion] Error parsing tool call arguments for streaming:', e);
                    }
                  }
                }

                if (onStreaming && streamingContent) {
                  onStreaming(completionId, streamingContent);
                }
                if (streamingContent) {
                  yield { type: 'text', content: streamingContent };
                }
              }
            }
          }
        } catch (error) {
          if (signal.aborted) {
            console.log('[ChatCompletion] Stream processing aborted');
            return;
          }
          console.error('[ChatCompletion] Stream processing error:', error);
          yield {
            type: 'error',
            content: `Error processing response: ${error.message}`,
            error
          };
          return;
        }
      } catch (error) {
        console.error('[ChatCompletion] API connection error:', error);
        let errorMessage = 'Failed to connect to the language model API';

        if (error instanceof Error) {
          const msg = error.message.toLowerCase();
          const isLocalhost = baseURL && (baseURL.includes('localhost') || baseURL.includes('127.0.0.1'));

          if (isLocalhost && (msg.includes('fetch') || msg.includes('network') || msg.includes('connection') || msg.includes('failed'))) {
            errorMessage = `Connection failed to ${baseURL}. If using Ollama, ensure it is running with CORS enabled: OLLAMA_ORIGINS="*" ollama serve`;
          } else if (msg.includes('404')) {
            errorMessage = `Invalid model endpoint: ${baseURL} or model: ${model}`;
          } else if (msg.includes('401') || msg.includes('403')) {
            errorMessage = `Authentication error: Invalid API key`;
          } else if (msg.includes('429')) {
            errorMessage = `Rate limit exceeded. Please try again later.`;
          } else if (msg.includes('timeout') || msg.includes('econnrefused')) {
            errorMessage = `Connection timeout. The model endpoint (${baseURL}) may be unavailable.`;
          } else {
            errorMessage = `API error: ${error.message}`;
          }
        }

        yield { type: 'error', content: errorMessage, error };
        return;
      }

      // Process accumulated response and tool calls
      try {
        if (signal.aborted) {
          console.log('[ChatCompletion] Parsing aborted');
          return;
        }

        // Handle tool calls
        if (accumulatedToolCalls.length > 0) {
          if (!onExecuteCode) {
            throw new Error('onExecuteCode is not defined');
          }

          for (const toolCall of accumulatedToolCalls) {
            if (toolCall.function.name === 'runCode') {
              if (signal.aborted) {
                console.log('[ChatCompletion] Tool execution aborted');
                return;
              }

              let args;
              try {
                args = JSON.parse(toolCall.function.arguments);
                // Remove null bytes that can cause execution errors
                if (args.code) {
                  args.code = args.code.replace(/\0/g, '').replace(/\u0000/g, '');
                }
              } catch (error) {
                console.error('[ChatCompletion] Error parsing runCode arguments:', error);
                yield {
                  type: 'error',
                  content: `Error parsing tool call arguments: ${error.message}`,
                  error
                };
                continue;
              }

              const code = args.code;
              const script_id = args.script_id || completionId;

              yield {
                type: 'function_call',
                name: 'runCode',
                arguments: args,
                call_id: toolCall.id
              };

              // Add assistant message with tool call to conversation
              messages.push({
                role: 'assistant',
                content: accumulatedResponse || undefined,
                tool_calls: [{
                  id: toolCall.id,
                  type: 'function',
                  function: {
                    name: 'runCode',
                    arguments: toolCall.function.arguments
                  }
                }]
              });

              if (onStreaming) {
                onStreaming(completionId, 'Executing code...');
              }

              try {
                const result = await onExecuteCode(script_id, code);

                yield {
                  type: 'function_call_output',
                  content: result,
                  call_id: toolCall.id
                };

                messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: result
                });
              } catch (error) {
                console.error('[ChatCompletion] Code execution error:', error);
                const errorMsg = `Error executing code: ${error instanceof Error ? error.message : String(error)}`;

                yield { type: 'error', content: errorMsg, error };

                messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: `Error: ${error instanceof Error ? error.message : String(error)}`
                });
              }

            } else if (toolCall.function.name === 'commitCodeBlocks') {
              let args;
              try {
                args = JSON.parse(toolCall.function.arguments);
              } catch (error) {
                console.error('[ChatCompletion] Error parsing commitCodeBlocks arguments:', error);
                yield {
                  type: 'error',
                  content: `Error parsing commitCodeBlocks arguments: ${error.message}`,
                  error
                };
                continue;
              }

              const code_block_ids = args.code_block_ids || [];
              console.log('[ChatCompletion] commitCodeBlocks called with ids:', code_block_ids);

              if (onMessage) {
                onMessage(completionId, accumulatedResponse || null, code_block_ids);
              }

              yield { type: 'text', content: accumulatedResponse };
              return;
            }
          }
        } else {
          // No tool calls - final text response
          if (accumulatedResponse) {
            if (onMessage) {
              onMessage(completionId, accumulatedResponse, []);
            }
            yield { type: 'text', content: accumulatedResponse };
          }
          return;
        }

        // Approaching max steps warning
        if (loopCount >= maxSteps - 2) {
          messages.push({
            role: 'user',
            content: `You are approaching the maximum number of steps (${maxSteps}). Please use the commitCodeBlocks tool to commit your working code and provide a final message, otherwise the session will be aborted and no code will be saved.`
          });
        }

        // Hit loop limit
        if (loopCount >= maxSteps) {
          console.warn(`[ChatCompletion] Reached maximum loop limit of ${maxSteps}`);
          const limitMsg = `Reached maximum number of tool calls (${maxSteps}). Returning control to you now.`;
          if (onMessage) {
            onMessage(completionId, limitMsg, []);
          }
          yield { type: 'text', content: limitMsg };
          break;
        }
      } catch (error) {
        console.error('[ChatCompletion] Processing error:', error);
        const errorMessage = error instanceof Error ? `Error: ${error.message}` : 'Failed to process the model response';

        yield { type: 'error', content: errorMessage, error };

        messages.push({
          role: 'user',
          content: `Error in processing: ${errorMessage}. Please try again with a simpler approach.`
        });
      }
    }
  } catch (err) {
    console.error('[ChatCompletion] Fatal error:', err);
    const errorMessage = `Chat completion error: ${err instanceof Error ? err.message : 'Unknown error'}`;

    yield {
      type: 'error',
      content: errorMessage,
      error: err instanceof Error ? err : new Error(errorMessage)
    };
  }
}
