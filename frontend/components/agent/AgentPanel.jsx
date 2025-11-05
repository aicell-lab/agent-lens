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
import NotebookContent from './NotebookContent';
import ChatInput from './ChatInput';
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
  
  // System cell tracking
  const systemCellIdRef = useRef(null);
  
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

        // Get Hypha server connection
        const server = await hyphaManager.getServer('hypha-agents');
        if (!mounted) return;
        
        appendLog('[AgentPanel] Connected to Hypha server');
        
        // Initialize kernel
        kernelManager.server = server;
        await kernelManager.initialize();
        if (!mounted) return;
        
        appendLog('[AgentPanel] Kernel initialized');
        setKernelStatus('ready');

        // Load agent configuration
        const systemCellCode = await loadAgentConfig(selectedMicroscopeId);
        if (!mounted) return;
        
        appendLog(`[AgentPanel] Loaded agent config for ${selectedMicroscopeId}`);

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
        
        // Execute system cell
        try {
          await cellManager.executeCell(systemCellId, async (code, callbacks) => {
            return await kernelManager.executePython(code, callbacks);
          });
          
          // Update cells after execution
          setCells([...cellManager.getCells()]);
          appendLog('[AgentPanel] Agent initialized successfully');
          
          if (showNotification) {
            showNotification('AI Assistant ready', 'success');
          }
        } catch (error) {
          console.error('[AgentPanel] System cell execution error:', error);
          appendLog(`[AgentPanel] System cell execution error: ${error.message}`);
          
          if (showNotification) {
            showNotification('Agent initialization warning: System cell execution failed', 'warning');
          }
        }
        
      } catch (error) {
        console.error('[AgentPanel] Initialization error:', error);
        appendLog(`[AgentPanel] Initialization error: ${error.message}`);
        setKernelStatus('error');
        
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
   */
  const handleSendMessage = useCallback(async (message) => {
    if (!message.trim() || kernelStatus !== 'ready' || isProcessing) {
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
      cellManager.setCurrentAgentCell(thinkingCellId);
      setCells([...cellManager.getCells()]);

      // Prepare chat history
      const history = cellManager.convertCellsToHistory();
      
      // Create abort controller
      abortControllerRef.current = new AbortController();

      // Start chat completion
      const chatStream = chatCompletion({
        messages: history,
        systemPrompt: '', // System prompt is in the system cell
        model: 'gpt-4',
        temperature: 0.7,
        baseURL: process.env.OPENAI_API_BASE_URL || 'https://api.openai.com/v1/',
        apiKey: process.env.OPENAI_API_KEY || '',
        maxSteps: 10,
        abortController: abortControllerRef.current,
        onExecuteCode: async (completionId, code) => {
          // Execute code in a code cell
          appendLog(`[AgentPanel] Executing code for completion ${completionId}`);
          
          const result = await cellManager.executeCell(completionId, async (code, callbacks) => {
            return await kernelManager.executePython(code, callbacks);
          });
          
          setCells([...cellManager.getCells()]);
          return result;
        },
        onStreaming: (completionId, content) => {
          // Update thinking cell with streaming content
          cellManager.updateCellById(thinkingCellId, content, 'thinking', 'assistant', userCellId);
          setCells([...cellManager.getCells()]);
        },
        onMessage: (completionId, finalMessage, commitIds) => {
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
        <div className="agent-panel-title">
          <i className="fas fa-robot mr-2"></i>
          <h3>AI Microscopy Assistant</h3>
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
            <span className="status-badge status-error">
              <i className="fas fa-exclamation-circle"></i> Error
            </span>
          )}
        </div>
      </div>

      <div className="agent-panel-content">
        <NotebookContent
          cells={cells}
          activeCellId={activeCellId}
          onActiveCellChange={handleActiveCellChange}
          isReady={kernelStatus === 'ready'}
        />
      </div>

      <div className="agent-panel-footer" style={{ fontSize: '0.85em' }}>
        <ChatInput
          onSend={handleSendMessage}
          onStop={handleStopGeneration}
          disabled={kernelStatus !== 'ready'}
          isProcessing={isProcessing}
          kernelStatus={kernelStatus}
          placeholder="Ask the AI assistant..."
        />
      </div>
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

