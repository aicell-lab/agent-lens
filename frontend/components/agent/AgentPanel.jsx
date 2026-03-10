/**
 * Agent Panel Component
 * Main component for AI agent interaction with microscope control.
 * Supports api.createWindow() via HyphaCore integration - when Python creates
 * a window, the panel expands to a split layout showing the canvas beside the notebook.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
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
import CanvasPanel, { isHtmlContent } from './CanvasPanel';
import './AgentPanel.css';

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

const AgentPanel = ({
  hyphaManager,
  selectedMicroscopeId,
  appendLog,
  showNotification,
  onExpandPanel,
}) => {
  // Kernel and cell management
  const [cellManager] = useState(() => new CellManager());
  const [kernelStatus, setKernelStatus] = useState('starting');
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

  // Canvas / HyphaCore windows state
  const [hyphaCoreWindows, setHyphaCoreWindows] = useState([]);
  const [activeWindowId, setActiveWindowId] = useState(null);

  const handleAddWindow = useCallback((config) => {
    const src = config.src || '';
    const isHtml = isHtmlContent(src);
    const newWindow = {
      id: config.window_id || generateId(),
      name: config.name || (isHtml ? 'HTML Content' : src || 'Window'),
      src: isHtml ? null : src,
      component: isHtml ? (
        <iframe
          srcDoc={src}
          title={config.name || 'HTML Content'}
          sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
          style={{ width: '100%', height: '100%', border: 'none' }}
        />
      ) : null,
    };
    setHyphaCoreWindows(prev => {
      // Avoid duplicates
      if (prev.some(w => w.id === newWindow.id)) return prev;
      return [...prev, newWindow];
    });
    setActiveWindowId(newWindow.id);
    if (onExpandPanel) onExpandPanel(true);
  }, [onExpandPanel]);

  // kernelManager is stored in a ref so a fresh instance can be created on re-init
  const handleAddWindowRef = useRef(handleAddWindow);
  useEffect(() => { handleAddWindowRef.current = handleAddWindow; }, [handleAddWindow]);

  const kernelManagerRef = useRef(null);

  // Close a canvas window
  const handleCloseWindow = useCallback((windowId) => {
    setHyphaCoreWindows(prev => {
      const next = prev.filter(w => w.id !== windowId);
      if (next.length === 0 && onExpandPanel) onExpandPanel(false);
      return next;
    });
    setActiveWindowId(prev => {
      if (prev !== windowId) return prev;
      const remaining = hyphaCoreWindows.filter(w => w.id !== windowId);
      return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    });
  }, [hyphaCoreWindows, onExpandPanel]);

  // Sync cells with CellManager
  useEffect(() => { cellManager.setCells(cells); }, [cells, cellManager]);
  useEffect(() => { cellManager.setActiveCellId(activeCellId); }, [activeCellId, cellManager]);

  /**
   * Initialize kernel and load agent configuration
   */
  useEffect(() => {
    let mounted = true;
    let initialized = false;

    // Destroy any existing kernel manager before creating a new one
    const previousManager = kernelManagerRef.current;
    kernelManagerRef.current = null;

    const initializeAgent = async () => {
      if (initialized) return;
      initialized = true;

      // Wait for previous manager to fully destroy before starting new one
      if (previousManager) {
        try {
          await previousManager.destroy();
        } catch (err) {
          console.warn('[AgentPanel] Error destroying previous kernel manager:', err);
        }
      }

      if (!mounted) return;

      // Create a fresh kernel manager instance for this microscope
      const kernelManager = new AgentKernelManager(null, {
        onAddWindow: (config) => handleAddWindowRef.current(config),
        get agentSettings() {
          return {
            model: getOpenAIModel(),
            apiKey: getOpenAIApiKey(),
            baseURL: getOpenAIBaseURL(),
          };
        },
      });
      kernelManagerRef.current = kernelManager;

      try {
        appendLog('[AgentPanel] Initializing agent...');
        setKernelStatus('starting');

        const token = hyphaManager.getCurrentToken();
        if (token) {
          appendLog('[AgentPanel] Using existing login token');
        } else {
          appendLog('[AgentPanel] No token available, will use login() in system cell');
        }

        const systemCellCode = await loadAgentConfig(selectedMicroscopeId, token || null);
        if (!mounted) return;

        appendLog(`[AgentPanel] Loaded agent config for ${selectedMicroscopeId}`);

        await kernelManager.initialize();
        if (!mounted) return;

        appendLog('[AgentPanel] Kernel initialized');
        setKernelStatus('ready');

        const systemCellId = cellManager.addCell(
          'code', systemCellCode, 'system', null, null, 0
        );
        systemCellIdRef.current = systemCellId;
        setCells([...cellManager.getCells()]);

        appendLog('[AgentPanel] Executing system cell...');

        try {
          let systemPromptOutput = '';

          await cellManager.executeCell(systemCellId, async (code, callbacks) => {
            const originalOnOutput = callbacks.onOutput;
            const wrappedCallbacks = {
              ...callbacks,
              onOutput: (output) => {
                if (output.type === 'stdout' && output.content) {
                  systemPromptOutput += output.content;
                }
                if (originalOnOutput) originalOnOutput(output);
              }
            };
            return await kernelManager.executePython(code, wrappedCallbacks);
          });

          if (systemPromptOutput.trim()) {
            setSystemPrompt(systemPromptOutput.trim());
            appendLog(`[AgentPanel] System prompt extracted (${systemPromptOutput.trim().length} chars)`);
          } else {
            setSystemPrompt('');
          }

          setCells([...cellManager.getCells()]);
          appendLog('[AgentPanel] Agent initialized successfully');

          if (showNotification) showNotification('AI Assistant ready', 'success');
        } catch (error) {
          console.error('[AgentPanel] System cell execution error:', error);
          appendLog(`[AgentPanel] System cell execution error: ${error.message}`);
          setSystemPrompt('');
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
      // kernelManager will be destroyed at the start of the next effect run
      // (after awaiting previousManager.destroy()), so no need to destroy here.
    };
  }, [hyphaManager, selectedMicroscopeId, cellManager, appendLog, showNotification]);

  /**
   * Handle user message send
   */
  const handleSendMessage = useCallback(async (message) => {
    if (!message.trim() || kernelStatus === 'starting' || isProcessing) return;

    const apiKey = getOpenAIApiKey();
    if (!apiKey) {
      if (showNotification) showNotification('Please configure your OpenAI API key in settings', 'error');
      setShowSettings(true);
      return;
    }

    try {
      setIsProcessing(true);
      appendLog(`[AgentPanel] User message: ${message}`);

      const userCellId = cellManager.addCell('markdown', message, 'user');
      setCells([...cellManager.getCells()]);
      setActiveCellId(userCellId);

      const thinkingCellId = cellManager.addCell(
        'thinking', '🤔 Thinking...', 'assistant', userCellId, userCellId
      );
      thinkingCellIdRef.current = thinkingCellId;
      cellManager.setCurrentAgentCell(thinkingCellId);
      setCells([...cellManager.getCells()]);

      const history = cellManager.convertCellsToHistory();
      abortControllerRef.current = new AbortController();

      const chatStream = chatCompletion({
        messages: history,
        systemPrompt,
        model: getOpenAIModel(),
        temperature: getOpenAITemperature() ?? 1,
        baseURL: getOpenAIBaseURL(),
        apiKey: getOpenAIApiKey(),
        maxSteps: 15,
        abortController: abortControllerRef.current,

        onExecuteCode: async (completionId, scriptContent) => {
          appendLog(`[AgentPanel] Executing code for completion ${completionId}`);

          const existingCell = cellManager.findCell(c => c.id === completionId);
          if (!existingCell) {
            cellManager.updateCellById(completionId, scriptContent, 'code', 'assistant', userCellId);
            setCells([...cellManager.getCells()]);
          } else if (existingCell.content !== scriptContent) {
            cellManager.updateCellContent(completionId, scriptContent);
            setCells([...cellManager.getCells()]);
          }

          if (kernelStatus !== 'ready') {
            const errMsg = 'Kernel is not available. Code execution requires the kernel to be running.';
            appendLog(`[AgentPanel] ${errMsg}`);
            cellManager.updateCellExecutionState(completionId, 'error', [{
              type: 'stderr', content: errMsg, short_content: errMsg,
              attrs: { className: 'output-area error-output', isProcessedAnsi: false }
            }]);
            setCells([...cellManager.getCells()]);
            return `[Cell Id: ${completionId}]\nError: ${errMsg}`;
          }

          try {
            const result = await cellManager.executeCell(completionId, async (code, callbacks) => {
              return await kernelManagerRef.current.executePython(code, callbacks);
            });
            setCells([...cellManager.getCells()]);
            return result;
          } catch (error) {
            const errMsg = `Kernel execution failed: ${error.message}`;
            appendLog(`[AgentPanel] ${errMsg}`);
            cellManager.updateCellExecutionState(completionId, 'error', [{
              type: 'stderr', content: errMsg, short_content: errMsg,
              attrs: { className: 'output-area error-output', isProcessedAnsi: false }
            }]);
            setCells([...cellManager.getCells()]);
            return `[Cell Id: ${completionId}]\nError: ${errMsg}`;
          }
        },

        onStreaming: (completionId, content) => {
          cellManager.updateCellById(thinkingCellId, content, 'thinking', 'assistant', userCellId);
          setCells([...cellManager.getCells()]);
        },

        onMessage: (_completionId, finalMessage, commitIds) => {
          // Replace thinking cell with final markdown response
          if (finalMessage) {
            cellManager.updateCellById(thinkingCellId, finalMessage, 'markdown', 'assistant', userCellId);
          } else {
            // commitCodeBlocks without message - just remove thinking cell
            cellManager.deleteCell(thinkingCellId);
          }

          // Mark uncommitted child cells as staged (hidden from user)
          if (commitIds !== undefined) {
            const childrenIds = cellManager.getCellChildrenIds ? cellManager.getCellChildrenIds(userCellId) : [];
            setCells(prev => prev.map(cell => {
              if (childrenIds.includes(cell.id) && cell.id !== _completionId) {
                const isCommitted = commitIds && commitIds.includes(cell.id);
                return {
                  ...cell,
                  metadata: {
                    ...cell.metadata,
                    staged: !isCommitted,
                    isOutputVisible: isCommitted,
                  }
                };
              }
              return cell;
            }));
          } else {
            setCells([...cellManager.getCells()]);
          }

          appendLog('[AgentPanel] Conversation completed');
        }
      });

      for await (const event of chatStream) {
        if (event.type === 'error') {
          console.error('[AgentPanel] Chat error:', event.error);
          appendLog(`[AgentPanel] Chat error: ${event.content}`);
          if (showNotification) showNotification(`Chat error: ${event.content}`, 'error');
          cellManager.updateCellById(
            thinkingCellId, `❌ Error: ${event.content}`, 'markdown', 'assistant', userCellId
          );
          setCells([...cellManager.getCells()]);
          break;
        }
      }

    } catch (error) {
      console.error('[AgentPanel] Message handling error:', error);
      appendLog(`[AgentPanel] Message handling error: ${error.message}`);
      if (showNotification) showNotification(`Error: ${error.message}`, 'error');
    } finally {
      setIsProcessing(false);
      abortControllerRef.current = null;
      thinkingCellIdRef.current = null;
      // Clean up any lingering thinking cells
      setCells(prev => prev.filter(cell => cell.type !== 'thinking'));
    }
  }, [
    kernelStatus, isProcessing, cellManager,
    appendLog, showNotification, systemPrompt
  ]);

  const handleStopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      appendLog('[AgentPanel] Stopping generation...');
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      setIsProcessing(false);
      if (showNotification) showNotification('Generation stopped', 'info');
    }
  }, [appendLog, showNotification]);

  const handleActiveCellChange = useCallback((cellId) => {
    setActiveCellId(cellId);
  }, []);

  const hasCanvas = hyphaCoreWindows.length > 0;

  return (
    <div className={`agent-panel-container ${hasCanvas ? 'with-canvas' : ''}`}>
      {/* Notebook side (always shown) */}
      <div className="agent-notebook-side">
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
                const errMsg = 'Kernel is not available.';
                cellManager.updateCellExecutionState(cellId, 'error', [{
                  type: 'stderr', content: errMsg, short_content: errMsg,
                  attrs: { className: 'output-area error-output', isProcessedAnsi: false }
                }]);
                setCells([...cellManager.getCells()]);
                return;
              }
              try {
                await cellManager.executeCell(cellId, async (code, callbacks) => {
                  return await kernelManagerRef.current.executePython(code, callbacks);
                });
                setCells([...cellManager.getCells()]);
              } catch (error) {
                cellManager.updateCellExecutionState(cellId, 'error', [{
                  type: 'stderr', content: error.message, short_content: error.message,
                  attrs: { className: 'output-area error-output', isProcessedAnsi: false }
                }]);
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
      </div>

      {/* Canvas side - shown when api.createWindow() creates windows */}
      {hasCanvas && (
        <div className="agent-canvas-side">
          <CanvasPanel
            windows={hyphaCoreWindows}
            activeWindowId={activeWindowId || hyphaCoreWindows[0]?.id}
            onSetActive={setActiveWindowId}
            onClose={handleCloseWindow}
          />
        </div>
      )}

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
  showNotification: PropTypes.func,
  onExpandPanel: PropTypes.func, // called with true/false when canvas panel appears/disappears
};

export default AgentPanel;
