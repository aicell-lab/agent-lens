/**
 * Cell Manager for Agent Panel
 * Manages notebook cell state and operations
 * Simplified JavaScript port from hypha-agents CellManager
 */

// Generate a unique ID for cells
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substring(2);
}

/**
 * Cell Manager class
 * Manages cell CRUD operations, execution, and state
 */
export class CellManager {
  constructor() {
    this.cells = [];
    this.activeCellId = null;
    this.executionCounter = 0;
    this.currentAgentCellId = null;
  }

  /**
   * Get current cells
   */
  getCells() {
    return this.cells;
  }

  /**
   * Set cells
   */
  setCells(cells) {
    this.cells = cells;
  }

  /**
   * Get active cell ID
   */
  getActiveCellId() {
    return this.activeCellId;
  }

  /**
   * Set active cell ID
   */
  setActiveCellId(id) {
    this.activeCellId = id;
  }

  /**
   * Add a new cell
   * @param {string} type - Cell type: 'code', 'markdown', 'thinking'
   * @param {string} content - Cell content
   * @param {string} role - Cell role: 'user', 'assistant', 'system'
   * @param {string} afterCellId - Insert after this cell ID
   * @param {string} parent - Parent cell ID
   * @param {number} insertIndex - Specific insert index
   * @param {string} cellId - Specific cell ID (optional)
   * @returns {string} - The new cell ID
   */
  addCell(type, content = '', role, afterCellId, parent, insertIndex, cellId) {
    const newCell = {
      id: cellId || generateId(),
      type,
      content: content || '',
      executionState: 'idle',
      role,
      metadata: {
        collapsed: false,
        trusted: true,
        isNew: type === 'code',
        isEditing: false,
        // Hide code and output by default for all code cells
        isCodeVisible: false,
        isOutputVisible: false,
        parent: parent,
        staged: false
      },
      output: []
    };

    // Determine insertion position
    if (typeof insertIndex === 'number' && insertIndex >= 0 && insertIndex <= this.cells.length) {
      this.cells.splice(insertIndex, 0, newCell);
    } else if (afterCellId) {
      const index = this.cells.findIndex(cell => cell.id === afterCellId);
      if (index !== -1) {
        this.cells.splice(index + 1, 0, newCell);
      } else {
        this.cells.push(newCell);
      }
    } else {
      this.cells.push(newCell);
    }

    this.activeCellId = newCell.id;
    return newCell.id;
  }

  /**
   * Update cell content
   */
  updateCellContent(id, content) {
    const cell = this.findCell(c => c.id === id);
    if (cell) {
      cell.content = content;
    }
  }

  /**
   * Update cell execution state
   */
  updateCellExecutionState(id, state, outputs) {
    const cell = this.findCell(c => c.id === id);
    if (!cell) return;

    cell.executionState = state;

    if (state === 'success' && cell.type === 'code') {
      cell.executionCount = this.executionCounter;
      this.executionCounter++;
    }

    if (outputs && outputs.length > 0) {
      cell.output = outputs;
    } else {
      cell.output = [];
    }
  }

  /**
   * Delete a cell
   */
  deleteCell(id) {
    this.cells = this.cells.filter(cell => cell.id !== id);
    
    // Update active cell if needed
    if (id === this.activeCellId) {
      this.activeCellId = this.cells.length > 0 ? this.cells[this.cells.length - 1].id : null;
    }
  }

  /**
   * Delete a cell and its children
   */
  deleteCellWithChildren(cellId) {
    const childrenIds = this.getCellChildrenIds(cellId);
    const allIdsToDelete = [cellId, ...childrenIds];
    
    this.cells = this.cells.filter(cell => !allIdsToDelete.includes(cell.id));
    
    // Update active cell if needed
    if (allIdsToDelete.includes(this.activeCellId)) {
      this.activeCellId = this.cells.length > 0 ? this.cells[this.cells.length - 1].id : null;
    }
  }

  /**
   * Find a cell by condition
   */
  findCell(predicate) {
    return this.cells.find(predicate);
  }

  /**
   * Find children cells
   */
  findChildrenCells(parentId) {
    if (!parentId) return [];
    return this.cells.filter(cell => cell.metadata?.parent === parentId);
  }

  /**
   * Get children cell IDs
   */
  getCellChildrenIds(parentId) {
    return this.findChildrenCells(parentId).map(cell => cell.id);
  }

  /**
   * Execute a cell
   * @param {string} id - Cell ID
   * @param {Function} executeCodeFn - Function to execute code
   * @returns {Promise<string>} - Execution result
   */
  async executeCell(id, executeCodeFn) {
    const cell = this.findCell(c => c.id === id);
    if (!cell || cell.type !== 'code' || !executeCodeFn) {
      throw new Error('Error: Cell not found or not a code cell');
    }

    const currentCode = cell.content;
    this.updateCellExecutionState(id, 'running');

    try {
      const outputs = [];
      let outputText = '';

      await executeCodeFn(currentCode, {
        onOutput: (output) => {
          outputs.push(output);
          outputText += output.content + '\n';
          this.updateCellExecutionState(id, 'running', outputs);
        },
        onStatus: (status) => {
          if (status === 'Completed') {
            this.updateCellExecutionState(id, 'success', outputs);
          } else if (status === 'Error') {
            this.updateCellExecutionState(id, 'error', outputs);
          }
        }
      });

      return `[Cell Id: ${id}]\n${outputText.trim() || 'Code executed successfully.'}`;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorOutput = {
        type: 'stderr',
        content: errorMessage,
        short_content: errorMessage
      };

      const currentCell = this.findCell(c => c.id === id);
      const currentOutputs = currentCell?.output || [];
      this.updateCellExecutionState(id, 'error', [...currentOutputs, errorOutput]);

      return `[Cell Id: ${id}]\nError executing code: ${errorMessage}`;
    }
  }

  /**
   * Toggle code visibility
   */
  toggleCodeVisibility(id) {
    const cell = this.findCell(c => c.id === id);
    if (cell && cell.metadata) {
      cell.metadata.isCodeVisible = !cell.metadata.isCodeVisible;
    }
  }

  /**
   * Hide code and output in the previous Python code cell (excluding system cells)
   * @param {string} currentCellId - The ID of the current cell
   */
  hidePreviousCodeCell(currentCellId) {
    const currentCellIndex = this.cells.findIndex(c => c.id === currentCellId);
    if (currentCellIndex === -1 || currentCellIndex === 0) return;

    // Find the most recent previous code cell (excluding system cells)
    for (let i = currentCellIndex - 1; i >= 0; i--) {
      const cell = this.cells[i];
      if (cell.type === 'code' && cell.role !== 'system' && cell.metadata) {
        cell.metadata.isCodeVisible = false;
        cell.metadata.isOutputVisible = false;
        return;
      }
    }
  }

  /**
   * Toggle output visibility
   */
  toggleOutputVisibility(id) {
    const cell = this.findCell(c => c.id === id);
    if (cell && cell.metadata) {
      cell.metadata.isOutputVisible = !cell.metadata.isOutputVisible;
    }
  }

  /**
   * Get or set current agent cell
   */
  getCurrentAgentCell() {
    return this.currentAgentCellId;
  }

  setCurrentAgentCell(cellId) {
    this.currentAgentCellId = cellId;
  }

  /**
   * Update or create cell by ID
   * Used for streaming updates from chat completion
   */
  updateCellById(cellId, content, type = 'markdown', role = 'assistant', parent) {
    const existingCell = this.findCell(c => c.id === cellId);

    if (existingCell) {
      // Update existing cell
      existingCell.content = content;
      existingCell.type = type;
      if (existingCell.metadata) {
        existingCell.metadata.parent = parent;
      }
    } else {
      // Create new cell
      let insertIndex;
      
      // Find insertion position
      if (parent) {
        const siblingCells = this.findChildrenCells(parent);
        if (siblingCells.length > 0) {
          const lastSiblingId = siblingCells[siblingCells.length - 1].id;
          insertIndex = this.cells.findIndex(cell => cell.id === lastSiblingId) + 1;
        } else {
          insertIndex = this.cells.findIndex(cell => cell.id === parent) + 1;
        }
      } else if (this.currentAgentCellId) {
        insertIndex = this.cells.findIndex(cell => cell.id === this.currentAgentCellId) + 1;
      } else {
        insertIndex = this.cells.length;
      }

      const newCell = {
        id: cellId,
        type,
        content,
        executionState: 'idle',
        role,
        metadata: {
          collapsed: false,
          trusted: true,
          isNew: type === 'code',
          isEditing: false,
          // Hide code and output by default for all code cells
          isCodeVisible: false,
          isOutputVisible: false,
          parent: parent,
          staged: false
        },
        output: []
      };

      this.cells.splice(insertIndex, 0, newCell);
      this.currentAgentCellId = cellId;
    }
  }

  /**
   * Convert cells to chat history format
   * @returns {Array} - Chat history messages
   */
  convertCellsToHistory() {
    const history = [];

    for (const cell of this.cells) {
      if (!cell.role) continue;
      if (cell.metadata?.staged === true) continue;
      if (cell.type === 'thinking') continue;

      if (cell.type === 'markdown') {
        history.push({
          role: cell.role,
          content: cell.content
        });
      } else if (cell.type === 'code') {
        // For system cells, only include output
        if (cell.role === 'system') {
          if (cell.output && cell.output.length > 0) {
            let content = '';
            for (const output of cell.output) {
              if (output.type === 'stdout' || output.type === 'stderr') {
                content += `${output.type === 'stderr' ? 'Error: ' : ''}${output.content}\n`;
              }
            }
            if (content) {
              history.push({
                role: cell.role,
                content: content.trim()
              });
            }
          }
        } else {
          // For non-system cells, include code and output
          let content = `<py-script>${cell.content}</py-script>`;
          history.push({
            role: cell.role,
            content: content.trim()
          });

          // Add outputs if they exist
          if (cell.output && cell.output.length > 0) {
            let outputContent = '\n<observation>\n';
            for (const output of cell.output) {
              if (output.type === 'stdout' || output.type === 'stderr') {
                outputContent += `${output.type === 'stderr' ? 'Error: ' : ''}${output.content}\n`;
              }
            }
            outputContent += '\n</observation>\n';
            history.push({
              role: 'user',
              content: outputContent.trim()
            });
          }
        }
      }
    }

    return history;
  }

  /**
   * Clear all cells
   */
  clearAllCells() {
    this.cells = [];
    this.activeCellId = null;
    this.currentAgentCellId = null;
  }

  /**
   * Collapse code cell (hide code, show output)
   */
  collapseCodeCell(cellId) {
    const cell = this.findCell(c => c.id === cellId);
    if (cell && cell.metadata) {
      cell.metadata.isCodeVisible = false;
    }
  }
}

