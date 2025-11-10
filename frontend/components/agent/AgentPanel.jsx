/**
 * Agent Panel Component
 * Main component for AI agent interaction with microscope control
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import { AgentKernelManager } from '../../utils/agentKernelManager';
import { CellManager } from '../../utils/cellManager';
import { chatCompletion } from '../../utils/chatCompletion';
import { loadAgentConfig } from '../../utils/agentConfigLoader';
import { getOpenAIApiKey, getOpenAIBaseURL, getOpenAIModel, getOpenAITemperature } from '../../utils/openaiConfig';
import NotebookContent from './NotebookContent';
import ChatInput from './ChatInput';
import AgentSettings from './AgentSettings';
import SystemPromptViewer from './SystemPromptViewer';
import './AgentPanel.css';

const AgentPanel = ({ 
  hyphaManager, 
  selectedMicroscopeId, 
  appendLog,
  showNotification 
}) => {
  // Kernel and cell management
  const [kernelManager] = useState(() => new AgentKernelManager(null));
  const [cellManager] = useState(() => new CellManager());
  const [kernelStatus, setKernelStatus] = useState('starting'); // 'starting', 'ready', 'error'
  const [isProcessing, setIsProcessing] = useState(false);
  
  // Cells state
  const [cells, setCells] = useState([]);
  const [activeCellId, setActiveCellId] = useState(null);
  
  // Chat completion state
  const abortControllerRef = useRef(null);
  const thinkingCellIdRef = useRef(null);
  
  // System cell tracking
  const systemCellIdRef = useRef(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  
  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  
  // Sync cells with CellManager
  useEffect(() => {
    cellManager.setCells(cells);
  }, [cells, cellManager]);
  
  useEffect(() => {
    cellManager.setActiveCellId(activeCellId);
  }, [activeCellId, cellManager]);

  /**
   * Initialize kernel and load agent configuration
   */
  useEffect(() => {
    let mounted = true;
    let initialized = false;

    const initializeAgent = async () => {
      if (initialized) return;
      initialized = true;

      try {
        appendLog('[AgentPanel] Initializing agent...');
        setKernelStatus('starting');

        // Get token from hyphaManager to reuse existing login (do this early)
        const token = hyphaManager.getCurrentToken();
        if (token) {
          appendLog('[AgentPanel] Using existing login token');
        } else {
          appendLog('[AgentPanel] No token available, will use login() in system cell');
        }

        // Load agent configuration with token injection
        const systemCellCode = await loadAgentConfig(selectedMicroscopeId, token || null);
        if (!mounted) return;
        
        appendLog(`[AgentPanel] Loaded agent config for ${selectedMicroscopeId}`);

        // Initialize kernel using local web-python-kernel
        await kernelManager.initialize();
        if (!mounted) return;
        
        appendLog('[AgentPanel] Kernel initialized');
        setKernelStatus('ready');

        // Create system cell
        const systemCellId = cellManager.addCell(
          'code',
          systemCellCode,
          'system',
          null,
          null,
          0
        );
        systemCellIdRef.current = systemCellId;
        
        // Update cells state
        setCells([...cellManager.getCells()]);
        
        appendLog('[AgentPanel] Executing system cell...');
        
        // Execute system cell and extract system prompt from printed output
        try {
          // Collect all stdout outputs during execution
          let systemPromptOutput = '';
          
          await cellManager.executeCell(systemCellId, async (code, callbacks) => {
            // Wrap the callbacks to capture stdout for system prompt extraction
            const originalOnOutput = callbacks.onOutput;
            const wrappedCallbacks = {
              ...callbacks,
              onOutput: (output) => {
                // Collect stdout outputs (system prompt is printed to stdout)
                if (output.type === 'stdout' && output.content) {
                  systemPromptOutput += output.content;
                }
                // Also call original callback
                if (originalOnOutput) {
                  originalOnOutput(output);
                }
              }
            };
            return await kernelManager.executePython(code, wrappedCallbacks);
          });
          
          // Extract system prompt from the printed output
          // The system prompt is printed via print(SYSTEM_PROMPT) in the system cell
          if (systemPromptOutput.trim()) {
            // The system prompt is the printed output from the system cell
            // It may contain other print statements before it, so we look for the SYSTEM_PROMPT content
            // Typically it's the last large block of text printed
            const extractedPrompt = systemPromptOutput.trim();
            setSystemPrompt(extractedPrompt);
            appendLog(`[AgentPanel] Extracted system prompt from execution output (${extractedPrompt.length} characters)`);
            console.log('[AgentPanel] System prompt extracted from execution:', extractedPrompt.substring(0, 100) + '...');
          } else {
            appendLog('[AgentPanel] No output from system cell, system prompt may be empty');
            setSystemPrompt('');
          }
          
          // Update cells after execution
          setCells([...cellManager.getCells()]);
          appendLog('[AgentPanel] Agent initialized successfully');
          
          if (showNotification) {
            showNotification('AI Assistant ready', 'success');
          }
        } catch (error) {
          console.error('[AgentPanel] System cell execution error:', error);
          appendLog(`[AgentPanel] System cell execution error: ${error.message}`);
          
          // System prompt will remain empty if execution fails
          setSystemPrompt('');
          
          if (showNotification) {
            showNotification('Agent initialization warning: System cell execution failed', 'warning');
          }
        }
        
      } catch (error) {
        console.error('[AgentPanel] Initialization error:', error);
        appendLog(`[AgentPanel] Initialization error: ${error.message}`);
        setKernelStatus('error');
        
        // The system prompt should already be extracted (it happens before kernel init)
        // The state variable in the catch block might not reflect the latest state due to closure
        // But the state should be set correctly via setSystemPrompt() above
        
        if (showNotification) {
          showNotification(`Agent initialization failed: ${error.message}`, 'error');
        }
      }
    };

    initializeAgent();

    return () => {
      mounted = false;
      // Cleanup kernel on unmount
      if (kernelManager) {
        kernelManager.destroy().catch(err => {
          console.error('[AgentPanel] Cleanup error:', err);
        });
      }
    };
  }, [hyphaManager, selectedMicroscopeId, kernelManager, cellManager, appendLog, showNotification]);

  /**
   * Handle user message send
   * Allow sending messages even when kernel has errors (chat-only mode)
   */
  const handleSendMessage = useCallback(async (message) => {
    if (!message.trim() || kernelStatus === 'starting' || isProcessing) {
      return;
    }

    // Check if API key is configured
    const apiKey = getOpenAIApiKey();
    if (!apiKey) {
      if (showNotification) {
        showNotification('Please configure your OpenAI API key in settings', 'error');
      }
      setShowSettings(true);
      return;
    }

    try {
      setIsProcessing(true);
      appendLog(`[AgentPanel] User message: ${message}`);

      // Add user message cell
      const userCellId = cellManager.addCell('markdown', message, 'user');
      setCells([...cellManager.getCells()]);
      setActiveCellId(userCellId);

      // Create thinking cell
      const thinkingCellId = cellManager.addCell(
        'thinking',
        '🤔 Thinking...',
        'assistant',
        userCellId,
        userCellId
      );
      thinkingCellIdRef.current = thinkingCellId;
      cellManager.setCurrentAgentCell(thinkingCellId);
      setCells([...cellManager.getCells()]);

      // Prepare chat history
      const history = cellManager.convertCellsToHistory();
      
      // Create abort controller
      abortControllerRef.current = new AbortController();

      // Start chat completion
      const chatStream = chatCompletion({
        messages: history,
        systemPrompt: systemPrompt, // System prompt extracted from system cell
        model: getOpenAIModel(),
        temperature: getOpenAITemperature() ?? 1, // Get from settings, fallback to 1
        baseURL: getOpenAIBaseURL(),
        apiKey: getOpenAIApiKey(),
        maxSteps: 10,
        abortController: abortControllerRef.current,
        onExecuteCode: async (completionId, scriptContent) => {
          // Execute code in a code cell
          appendLog(`[AgentPanel] Executing code for completion ${completionId}`);
          
          // Update the cell with the script content if it doesn't exist yet
          const existingCell = cellManager.findCell(c => c.id === completionId);
          if (!existingCell) {
            cellManager.updateCellById(completionId, scriptContent, 'code', 'assistant', userCellId);
            // Hide code in previous Python cell after creating new one
            cellManager.hidePreviousCodeCell(completionId);
            setCells([...cellManager.getCells()]);
          } else if (existingCell.content !== scriptContent) {
            cellManager.updateCellContent(completionId, scriptContent);
            setCells([...cellManager.getCells()]);
          }
          
          // Check if kernel is available
          if (kernelStatus !== 'ready') {
            const errorMessage = 'Kernel is not available. Code execution requires the Deno kernel service to be running.';
            appendLog(`[AgentPanel] ${errorMessage}`);
            
            // Create error output
            const errorOutput = {
              type: 'stderr',
              content: errorMessage,
              short_content: errorMessage,
              attrs: {
                className: 'output-area error-output',
                isProcessedAnsi: false
              }
            };
            
            cellManager.updateCellExecutionState(completionId, 'error', [errorOutput]);
            setCells([...cellManager.getCells()]);
            
            return `[Cell Id: ${completionId}]\nError: ${errorMessage}`;
          }
          
          try {
            const result = await cellManager.executeCell(completionId, async (code, callbacks) => {
              return await kernelManager.executePython(code, callbacks);
            });
            
            setCells([...cellManager.getCells()]);
            return result;
          } catch (error) {
            const errorMessage = `Kernel execution failed: ${error.message}`;
            appendLog(`[AgentPanel] ${errorMessage}`);
            
            const errorOutput = {
              type: 'stderr',
              content: errorMessage,
              short_content: errorMessage,
              attrs: {
                className: 'output-area error-output',
                isProcessedAnsi: false
              }
            };
            
            cellManager.updateCellExecutionState(completionId, 'error', [errorOutput]);
            setCells([...cellManager.getCells()]);
            
            return `[Cell Id: ${completionId}]\nError: ${errorMessage}`;
          }
        },
        onStreaming: (completionId, content) => {
          // Update thinking cell with streaming content
          cellManager.updateCellById(thinkingCellId, content, 'thinking', 'assistant', userCellId);
          setCells([...cellManager.getCells()]);
        },
        onMessage: (completionId, finalMessage) => {
          // Replace thinking cell with final message
          cellManager.updateCellById(thinkingCellId, finalMessage, 'markdown', 'assistant', userCellId);
          setCells([...cellManager.getCells()]);
          appendLog(`[AgentPanel] Conversation completed`);
        }
      });

      // Process chat stream
      for await (const event of chatStream) {
        if (event.type === 'error') {
          console.error('[AgentPanel] Chat error:', event.error);
          appendLog(`[AgentPanel] Chat error: ${event.content}`);
          
          if (showNotification) {
            showNotification(`Chat error: ${event.content}`, 'error');
          }
          
          // Update thinking cell with error
          cellManager.updateCellById(
            thinkingCellId,
            `❌ Error: ${event.content}`,
            'markdown',
            'assistant',
            userCellId
          );
          setCells([...cellManager.getCells()]);
          break;
        }
        
        // Handle other event types (new_completion, function_call, etc.)
        // These are handled by the callbacks above
      }

    } catch (error) {
      console.error('[AgentPanel] Message handling error:', error);
      appendLog(`[AgentPanel] Message handling error: ${error.message}`);
      
      if (showNotification) {
        showNotification(`Error: ${error.message}`, 'error');
      }
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
      thinkingCellIdRef.current = null;
    }
  }, [
    kernelStatus, 
    isProcessing, 
    cellManager, 
    kernelManager, 
    appendLog, 
    showNotification
  ]);

  /**
   * Handle stop generation
   */
  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      appendLog('[AgentPanel] Stopping generation...');
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsProcessing(false);
      
      if (showNotification) {
        showNotification('Generation stopped', 'info');
      }
    }
  }, [appendLog, showNotification]);

  /**
   * Handle cell activation
   */
  const handleActiveCellChange = useCallback((cellId) => {
    setActiveCellId(cellId);
  }, []);

  return (
    <div className="agent-panel-container">
      <div className="agent-panel-header">
        <div 
          className="agent-panel-title"
          onClick={() => setShowSystemPrompt(true)}
          style={{ cursor: 'pointer', userSelect: 'none' }}
          title="Click to view system prompt"
        >
          <i className="fas fa-robot mr-2"></i>
          <h4 style={{ fontSize: '0.85rem', margin: 0 }}>AI Microscopy Assistant</h4>
        </div>
        <div className="agent-panel-actions">
          <button
            className="agent-panel-settings-button"
            onClick={() => setShowSettings(true)}
            title="Open settings"
          >
            <i className="fas fa-cog"></i>
          </button>
        </div>
        <div className="agent-panel-status">
          {kernelStatus === 'starting' && (
            <span className="status-badge status-starting">
              <i className="fas fa-spinner fa-spin"></i> Initializing...
            </span>
          )}
          {kernelStatus === 'ready' && (
            <span className="status-badge status-ready">
              <i className="fas fa-check-circle"></i> Ready
            </span>
          )}
          {kernelStatus === 'error' && (
            <span className="status-badge status-error" title="Kernel unavailable - chat mode only">
              <i className="fas fa-exclamation-circle"></i> Kernel Unavailable
            </span>
          )}
        </div>
      </div>

      <div className="agent-panel-content">
        <NotebookContent
          cells={cells}
          activeCellId={activeCellId}
          onActiveCellChange={handleActiveCellChange}
          onExecuteCell={async (cellId) => {
            if (kernelStatus !== 'ready') {
              const errorMessage = 'Kernel is not available. Code execution requires the Deno kernel service to be running.';
              appendLog(`[AgentPanel] ${errorMessage}`);
              
              const errorOutput = {
                type: 'stderr',
                content: errorMessage,
                short_content: errorMessage,
                attrs: {
                  className: 'output-area error-output',
                  isProcessedAnsi: false
                }
              };
              
              cellManager.updateCellExecutionState(cellId, 'error', [errorOutput]);
              setCells([...cellManager.getCells()]);
              return;
            }
            
            try {
              await cellManager.executeCell(cellId, async (code, callbacks) => {
                return await kernelManager.executePython(code, callbacks);
              });
              setCells([...cellManager.getCells()]);
            } catch (error) {
              console.error('[AgentPanel] Cell execution error:', error);
              appendLog(`[AgentPanel] Cell execution error: ${error.message}`);
              
              const errorOutput = {
                type: 'stderr',
                content: error.message,
                short_content: error.message,
                attrs: {
                  className: 'output-area error-output',
                  isProcessedAnsi: false
                }
              };
              
              cellManager.updateCellExecutionState(cellId, 'error', [errorOutput]);
              setCells([...cellManager.getCells()]);
            }
          }}
          onDeleteCell={(cellId) => {
            cellManager.deleteCell(cellId);
            setCells([...cellManager.getCells()]);
          }}
          onToggleCodeVisibility={(cellId) => {
            cellManager.toggleCodeVisibility(cellId);
            setCells([...cellManager.getCells()]);
          }}
          onToggleOutputVisibility={(cellId) => {
            cellManager.toggleOutputVisibility(cellId);
            setCells([...cellManager.getCells()]);
          }}
          onStopGeneration={handleStopGeneration}
          isReady={kernelStatus === 'ready'}
          cellManager={cellManager}
        />
      </div>

      <div className="agent-panel-footer" style={{ fontSize: '0.85em' }}>
        <ChatInput
          onSend={handleSendMessage}
          onStop={handleStopGeneration}
          disabled={kernelStatus === 'starting'}
          isProcessing={isProcessing}
          kernelStatus={kernelStatus}
          placeholder={kernelStatus === 'error' ? "Chat mode only (kernel unavailable)..." : "Ask the AI assistant..."}
        />
      </div>

      <AgentSettings 
        isOpen={showSettings} 
        onClose={() => setShowSettings(false)} 
      />

      <SystemPromptViewer
        isOpen={showSystemPrompt}
        onClose={() => setShowSystemPrompt(false)}
        systemPrompt={systemPrompt}
      />
    </div>
  );
};

AgentPanel.propTypes = {
  hyphaManager: PropTypes.object.isRequired,
  selectedMicroscopeId: PropTypes.string.isRequired,
  appendLog: PropTypes.func.isRequired,
  showNotification: PropTypes.func
};

export default AgentPanel;

