/**
 * ANSI Color Code Utilities
 * Converts ANSI escape codes to HTML for display in output
 */

// Simple ANSI to HTML converter
// This is a simplified version - for full support, consider using 'ansi-to-html' npm package
export const processTextOutput = (text) => {
  if (!text || typeof text !== 'string') {
    return text;
  }

  // Check if text contains ANSI codes
  const hasAnsi = text.includes('\u001b[') || text.includes('[0;') || text.includes('[1;');
  
  if (!hasAnsi) {
    // No ANSI codes, just handle newlines
    const lines = text.split('\n').filter(line => line.trim() !== '');
    if (lines.length === 1) {
      return `<pre class="output-line">${escapeHtml(lines[0])}</pre>`;
    }
    return `<pre class="output-multiline">${lines.map(line => escapeHtml(line)).join('<br>')}</pre>`;
  }

  // Basic ANSI code processing
  // Colors mapping
  const colors = {
    '0': '#000000',   // black
    '1': '#e74c3c',   // red
    '2': '#2ecc71',   // green
    '3': '#f1c40f',   // yellow
    '4': '#3498db',   // blue
    '5': '#9b59b6',   // magenta
    '6': '#1abc9c',   // cyan
    '7': '#ecf0f1',   // light gray
    '30': '#000000',  // black
    '31': '#e74c3c',  // red
    '32': '#2ecc71',  // green
    '33': '#f1c40f',  // yellow
    '34': '#3498db',  // blue
    '35': '#9b59b6',  // magenta
    '36': '#1abc9c',  // cyan
    '37': '#ecf0f1',  // white
  };

  let result = '';
  let currentColor = null;
  let i = 0;

  while (i < text.length) {
    if (text[i] === '\u001b' && text[i + 1] === '[') {
      // Found ANSI escape sequence
      let j = i + 2;
      let code = '';
      
      while (j < text.length && text[j] !== 'm') {
        code += text[j];
        j++;
      }

      if (j < text.length) {
        // Close previous span if exists
        if (currentColor) {
          result += '</span>';
        }

        // Parse color code
        const codes = code.split(';');
        const colorCode = codes[0];
        
        if (colorCode === '0') {
          // Reset
          currentColor = null;
        } else if (colors[colorCode]) {
          currentColor = colors[colorCode];
          result += `<span style="color: ${currentColor}">`;
        }

        i = j + 1;
        continue;
      }
    }

    // Regular character
    if (currentColor === null && (text[i] === '\n' || text[i] === '\r')) {
      result += '<br>';
    } else {
      result += escapeHtml(text[i]);
    }
    i++;
  }

  // Close any open span
  if (currentColor) {
    result += '</span>';
  }

  // Filter empty lines
  const lines = result.split('<br>').filter(line => line.trim() !== '');
  
  if (lines.length === 1) {
    return `<pre class="output-line">${lines[0]}</pre>`;
  }
  
  return `<pre class="output-multiline">${lines.join('<br>')}</pre>`;
};

// Escape HTML special characters
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

