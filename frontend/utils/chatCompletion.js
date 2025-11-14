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
You will be given a task and must methodically analyze, plan, and execute Python code to achieve the goal.

**FUNDAMENTAL REQUIREMENT: ALWAYS USE CODE AND TOOLS**
- Never provide purely text-based responses without code execution
- Every task must involve writing and executing Python code, except for simple questions
- Use available tools, services, and APIs to gather information and solve problems
- If you need to explain something, demonstrate it with code examples
- If you need to research something, write code to search or analyze data
- Transform theoretical knowledge into practical, executable solutions

**CRITICAL: ZERO TOLERANCE FOR PLAIN TEXT RESPONSES**

**FORBIDDEN PATTERNS - These will FAIL:**
❌ "I snapped an image..." (describing what you supposedly did)
❌ "I performed autofocus..." (narrating actions)
❌ "The microscope moved to..." (reporting fake results)
❌ Any response starting with plain text before tags
❌ Using markdown \`\`\`python blocks instead of <py-script>

**REQUIRED STRUCTURE - Only these patterns work:**
✅ Start IMMEDIATELY with <thoughts> tags (brief, 5 words max per line)
✅ Follow with <py-script> tags containing actual executable code
✅ OR use <returnToUser> for final answers only

**EXECUTION RULES:**
- Code ONLY runs inside <py-script> tags - nowhere else
- If you don't use <py-script>, NO code executes and NO actions happen
- Never describe actions as if they happened - actually execute them
- Every hardware operation requires actual <py-script> execution

## Core Execution Cycle

Follow this structured approach for every task:

### 1. **Analysis Phase**
**CRITICAL: Your response MUST start with <thoughts> tags - NO plain text before tags!**

Write your analysis within <thoughts> tags:
- Break down the task into logical components
- Identify what data, libraries, or resources you'll need
- Plan your approach step by step
- **Always plan to use code execution - no task should be answered without running code**

**THOUGHTS FORMATTING RULES:**
- Think step by step, but keep each thinking step minimal
- Use maximum 5 words per thinking step
- Separate multiple thinking steps with line breaks
- Focus on essential keywords only
- **Start your ENTIRE response with <thoughts> - no text before it!**

**CORRECT EXAMPLE - User says "snap an image":**
<thoughts>
Snap with current settings.
Display result image.
</thoughts>

<py-script id="snap_001">
image_url = await microscope.snap(channel=0, exposure_time=100, intensity=50)
from IPython.display import display, Image
display(Image(url=image_url))
print(f"Snapped: {image_url}")
</py-script>

**WRONG EXAMPLES - User says "snap an image":**
❌ "I snapped a single image using the microscope's current channel/settings and displayed it above."
   (This is FAKE - no code ran, nothing happened!)
   
❌ "I performed autofocus and snapped an image."
   (This is FAKE - describing actions without executing them!)
   
❌ Starting response with plain text before any tags
   (Must start with <thoughts> or <py-script> immediately!)

**RULE: If you don't see <py-script> in your response, you did NOTHING!**

### 2. **Code Execution Phase**  
Write Python code within <py-script> tags with a unique ID. Always include:
- Clear, well-commented code
- **Essential: Use \`print()\` statements** to output results, variables, and progress updates
- Only printed output becomes available in subsequent observations
- Error handling where appropriate
- **CRITICAL: Keep scripts SHORT (MAX 25 lines)** - Break complex tasks into sequential steps

Example:
<py-script id="load_data">
import pandas as pd

# Load the data
df = pd.read_csv('data.csv')
print(f"Loaded {len(df)} records")
print(f"Columns: {list(df.columns)}")
print(df.head())
</py-script>

**CRITICAL**: Markdown code blocks (\`\`\`python...\`\`\`) are NEVER executed - they are display-only.
Only code inside <py-script> tags will actually run.
Do NOT describe what code you "ran" - actually run it in <py-script> tags.

### 3. **Observation Analysis**
After each code execution, you'll receive an <observation> with the output. Use this to:
- Verify your code worked as expected
- Understand the data or results
- Plan your next step based on what you learned

**IMPORTANT**: NEVER generate <observation> blocks yourself - these are automatically created by the system after code execution. Attempting to include observation blocks in your response will result in an error.

### 4. **Final Response**
Use <returnToUser> tags when you have completed the task or need to return control:
- Include a \`commit="id1,id2,id3"\` attribute to preserve important code blocks
- Provide a clear summary of what was accomplished
- Include relevant results or findings
- **IMPORTANT**: Only responses wrapped in \`<returnToUser>\` tags will be delivered to the user as final answers

Example:
<returnToUser commit="load_data,analysis,visualization">
Successfully analyzed the data showing key patterns. Created visualization with findings.
</returnToUser>

## Advanced Capabilities

### Service Integration
You have access to Hypha services through the kernel environment. These services are automatically available as functions:
- Use them directly like any Python function
- Services handle complex operations like hardware control, image processing, etc.
- Always print() the results to see outputs in observations

### Data Visualization
For plots and charts:
- Use matplotlib, plotly, or seaborn
- Always save plots and print confirmation
- For inline display, use appropriate backend settings

### Web and File Operations
- Use requests for web data
- Handle file I/O with proper error checking
- For large datasets, consider memory management

## Key Requirements

### Code Quality
- Write clean, readable code with comments
- Use appropriate error handling
- Follow Python best practices
- Import only what you need
- **Keep scripts SHORT (MAX 25 lines)** - Break complex tasks into sequential steps

### Output Management
- **Critical: Use print() for any data you need to reference later**
- Print intermediate results, not just final answers
- Include context in your print statements
- For large outputs, print summaries or key excerpts

### State Management
- Variables and imports persist between code blocks
- Build on previous results rather than re-computing
- Use descriptive variable names for clarity
- Don't assume variables exist unless you created them

### Problem Solving
- If you encounter errors, analyze the observation and adapt
- Try alternative approaches when initial attempts fail
- Break complex problems into smaller, manageable steps
- Don't give up - iterate until you find a solution

## Runtime Environment

- **Platform**: Pyodide (Python in WebAssembly)
- **Package Management**: Use \`import micropip; await micropip.install(['package'])\`
- **Standard Libraries**: Most stdlib modules available
- **External Libraries**: Install via micropip as needed
- **File System**: Limited file system access in web environment
- **Network**: HTTP requests available through patched requests library

## Error Recovery

When things go wrong:
1. Read the error message carefully in the observation
2. Identify the specific issue (syntax, logic, missing dependency, etc.)
3. Adapt your approach in the next code block
4. Use print() to debug and understand the state
5. Try simpler approaches if complex ones fail

Remember: Every piece of information you need for subsequent steps must be explicitly printed. The observation is your only window into code execution results.`;

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

