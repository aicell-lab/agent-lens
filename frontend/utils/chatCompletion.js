/**
 * Chat Completion utility for Agent Panel
 * Simplified JavaScript port from hypha-agents chatCompletion
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
 * Response instructions for the AI agent
 * Based on hypha-agents pattern, optimized for clarity and token efficiency
 * These instructions MUST be placed FIRST in the system prompt
 */
const RESPONSE_INSTRUCTIONS = `You are a powerful coding assistant capable of solving complex tasks by writing and executing Python code while controlling laboratory hardware.

**CORE PRINCIPLES**
1. Exact scope: follow the user's literal request and execute the smallest set of actions needed. Never add extra operations without explicit approval.
2. Safety and clarity: confirm with the user before optional actions or when information is missing.
3. Tool-first execution: use Python code for any non-trivial request, keep every script <=25 lines, and print key results.

**RESPONSE FORMAT**
- Wrap planning inside <thoughts>...</thoughts>. Provide at most four short lines (<=5 words each) that clearly break down the task.
- Immediately follow thoughts with one <py-script id="...">...</py-script> block that runs a single short script. Execute scripts sequentially.
- When the task is complete, respond with <returnToUser commit="...">...</returnToUser> containing a concise summary (<=3 sentences) of actions and outcomes.
- Do not emit plain text outside of these tags.

**MINIMAL ACTION GUARDRAIL**
- "move to well B2" -> only call await microscope.navigate_to_well('B', 2, well_plate_type='96').
- "snap an image" -> only call await microscope.snap(...).
- "move to B2 and focus" -> navigate first, then run the requested focus routine.
- Ask the user before performing extra movements, imaging, scans, or analysis.

**EXECUTION LOOP**
1. Plan with <thoughts>.
2. Run a <=25 line script inside <py-script>.
3. Inspect the <observation> produced by the system.
4. Repeat until done, then send <returnToUser>.
- Use print() to expose all values needed later.
- Handle errors with clear messages and adjust the plan if something fails.
- **CRITICAL: Image URLs are NOT visible when printed** - Always use \`IPython.display.Image()\` to show images to users, never just print URLs.
- **Image handling pattern**: \`url = await microscope.snap(...); from IPython.display import display, Image; display(Image(url=url))\`, for analysis, use numpy arrays.

**PROHIBITED**
- Generating <observation> blocks yourself.
- Using Markdown code fences (three backticks).
- Bundling multiple independent tasks into one script.
- Continuing after the user aborts or after the maximum step reminder.

**RUNTIME NOTES**
- Imports and variables persist between scripts.
- Install extra packages with micropip when necessary.
- Network calls are available via requests or aiohttp.
- **Printed image URLs are invisible to users** - use \`IPython.display.Image()\` to show images.
- Log important state, stay concise, and iterate methodically.`;

/**
 * Validate agent output
 */
function validateAgentOutput(content) {
  const observationPattern = /<observation[^>]*>[\s\S]*?<\/observation>/gi;
  const matches = content.match(observationPattern);
  
  if (matches && matches.length > 0) {
    const errorMessage = `Agent attempted to generate observation blocks, which are reserved for system use only.`;
    console.error('[ChatCompletion] Agent output validation failed:', matches);
    throw new Error(errorMessage);
  }
}

/**
 * Extract returnToUser content
 */
function extractReturnToUser(script) {
  const match = script.match(/<returnToUser(?:\s+([^>]*))?>([\s\S]*?)<\/returnToUser>/);
  if (!match) return null;

  const properties = {};
  const [, attrs, content] = match;

  if (attrs) {
    const propRegex = /(\w+)=["']([^"']*)["']/g;
    let propMatch;
    while ((propMatch = propRegex.exec(attrs)) !== null) {
      const [, key, value] = propMatch;
      properties[key] = value;
    }
  }

  return {
    content: content.trim(),
    properties
  };
}

/**
 * Extract thoughts content
 */
function extractThoughts(script) {
  const match = script.match(/<thoughts>([\s\S]*?)<\/thoughts>/);
  return match ? match[1].trim() : null;
}

/**
 * Extract py-script content
 */
function extractScript(script) {
  const match = script.match(/<py-script(?:\s+[^>]*)?>([\s\S]*?)<\/py-script>/);
  return match ? match[1].trim() : null;
}

/**
 * Chat completion generator
 * @param {Object} options - Chat completion options
 * @returns {AsyncGenerator} - Yields chat completion events
 */
export async function* chatCompletion({
  messages,
  systemPrompt = '',
  model = 'gpt-5-mini', // Default to fastest GPT-5 model
  temperature = 1,
  onExecuteCode,
  onMessage,
  onStreaming,
  maxSteps = 10,
  baseURL,
  apiKey,
  stream = true,
  abortController
}) {
  try {
    const controller = abortController || new AbortController();
    const { signal } = controller;

    // CRITICAL: Place RESPONSE_INSTRUCTIONS FIRST to ensure the model follows the format
    // The domain-specific system prompt comes after, so format requirements take priority
    systemPrompt = RESPONSE_INSTRUCTIONS + '\n\n' + (systemPrompt || '');
    
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

      try {
        const requestParams = {
          model,
          messages: fullMessages,
          stream: stream
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

            const content = chunk.choices[0]?.delta?.content || '';
            accumulatedResponse += content;

            try {
              validateAgentOutput(accumulatedResponse);
            } catch (error) {
              console.error('[ChatCompletion] Validation failed:', error);
              yield {
                type: 'error',
                content: `Agent output validation failed: ${error.message}`,
                error: error
              };
              return;
            }

            if (onStreaming) {
              onStreaming(completionId, accumulatedResponse);
            }
            
            yield {
              type: 'text',
              content: accumulatedResponse
            };
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
            error: error
          };
          return;
        }
      } catch (error) {
        console.error('[ChatCompletion] API connection error:', error);
        let errorMessage = 'Failed to connect to the language model API';

        if (error instanceof Error) {
          if (error.message.includes('404')) {
            errorMessage = `Invalid model endpoint: ${baseURL} or model: ${model}`;
          } else if (error.message.includes('401') || error.message.includes('403')) {
            errorMessage = `Authentication error: Invalid API key`;
          } else if (error.message.includes('429')) {
            errorMessage = `Rate limit exceeded. Please try again later.`;
          } else if (error.message.includes('timeout') || error.message.includes('ECONNREFUSED')) {
            errorMessage = `Connection timeout. The model endpoint (${baseURL}) may be unavailable.`;
          } else {
            errorMessage = `API error: ${error.message}`;
          }
        }

        yield {
          type: 'error',
          content: errorMessage,
          error: error
        };
        return;
      }

      // Parse and validate the accumulated response
      try {
        if (signal.aborted) {
          console.log('[ChatCompletion] Parsing aborted');
          return;
        }

        // Final validation
        try {
          validateAgentOutput(accumulatedResponse);
        } catch (error) {
          console.error('[ChatCompletion] Final validation failed:', error);
          yield {
            type: 'error',
            content: `Agent output validation failed: ${error.message}`,
            error: error
          };
          return;
        }

        // Extract thoughts
        const thoughts = extractThoughts(accumulatedResponse);
        if (thoughts) {
          console.log('[ChatCompletion] Thoughts:', thoughts);
        }

        // Check for final response
        const returnToUser = extractReturnToUser(accumulatedResponse);
        if (returnToUser) {
          if (onMessage) {
            const commitIds = returnToUser.properties.commit
              ? returnToUser.properties.commit.split(',').map(id => id.trim())
              : [];
            onMessage(completionId, returnToUser.content, commitIds);
          }
          yield {
            type: 'text',
            content: returnToUser.content
          };
          return;
        }

        // Handle script execution
        if (!onExecuteCode) {
          throw new Error('onExecuteCode is not defined');
        }

        const scriptContent = extractScript(accumulatedResponse);
        if (scriptContent) {
          if (signal.aborted) {
            console.log('[ChatCompletion] Tool execution aborted');
            return;
          }

          yield {
            type: 'function_call',
            name: 'runCode',
            arguments: {
              code: scriptContent
            },
            call_id: completionId
          };

          // Add tool call to messages
          messages.push({
            role: 'assistant',
            content: `<thoughts>${thoughts}</thoughts>\n<py-script id="${completionId}">${scriptContent}</py-script>`
          });

          if (onStreaming) {
            onStreaming(completionId, `Executing code...`);
          }

          // Execute the tool call
          try {
            const result = await onExecuteCode(completionId, scriptContent);

            yield {
              type: 'function_call_output',
              content: result,
              call_id: completionId
            };

            // Add tool response to messages
            messages.push({
              role: 'user',
              content: `<observation>I have executed the code. Here are the outputs:\n\`\`\`\n${result}\n\`\`\`\nNow continue with the next step.</observation>`
            });
          } catch (error) {
            console.error('[ChatCompletion] Code execution error:', error);
            const errorMessage = `Error executing code: ${error.message}`;

            yield {
              type: 'error',
              content: errorMessage,
              error: error
            };

            messages.push({
              role: 'user',
              content: `<observation>Error executing the code: ${error.message}\nPlease try a different approach.</observation>`
            });
          }
        } else {
          // No proper tags - send explicit reminder with format example
          const reminder = `🚨 CRITICAL: You MUST use the required tags in your responses!

Your response MUST follow this exact format:

<thoughts>
Brief planning steps.
</thoughts>

<py-script id="unique_id">
# Your code here
</py-script>

OR when finished:

<returnToUser commit="ids">
Final answer.
</returnToUser>

**FORBIDDEN:** Plain text explanations, markdown code blocks, or responses without tags.

Your previous response was rejected because it didn't use the required tags:
"${accumulatedResponse.substring(0, 200)}${accumulatedResponse.length > 200 ? '...' : ''}"

Please provide a new response using the required <thoughts> and <py-script> or <returnToUser> tags.`;
          
          messages.push({
            role: 'user',
            content: reminder
          });
        }

        // Reminder if approaching max steps
        if (loopCount >= maxSteps - 2) {
          messages.push({
            role: 'user',
            content: `You are approaching the maximum number of steps (${maxSteps}). Please conclude the session with \`returnToUser\` tag and commit the current code and outputs.`
          });
        }

        // Check loop limit
        if (loopCount >= maxSteps) {
          console.warn(`[ChatCompletion] Reached maximum loop limit of ${maxSteps}`);
          if (onMessage) {
            onMessage(completionId, `Reached maximum number of tool calls (${maxSteps}). Returning control to you now.`, []);
          }
          yield {
            type: 'text',
            content: `Reached maximum number of tool calls (${maxSteps}). Returning control to you now.`
          };
          break;
        }
      } catch (error) {
        console.error('[ChatCompletion] Processing error:', error);
        let errorMessage = 'Failed to process the model response';

        if (error instanceof Error) {
          errorMessage = `Error: ${error.message}`;
        }

        yield {
          type: 'error',
          content: errorMessage,
          error: error
        };

        messages.push({
          role: 'user',
          content: `<observation>Error in processing: ${errorMessage}. Please try again with a simpler approach.</observation>`
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
