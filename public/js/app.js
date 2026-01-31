/**
 * LLM Response Comparer - Frontend Application
 * Handles UI interactions, streaming, and real-time updates
 */

// DOM Elements
const promptInput = document.getElementById('prompt');
const leftModelSelect = document.getElementById('leftModel');
const rightModelSelect = document.getElementById('rightModel');
const compareBtn = document.getElementById('compareBtn');
const clearBtn = document.getElementById('clearBtn');
const resultsSection = document.getElementById('resultsSection');
const errorSection = document.getElementById('errorSection');
const errorMessage = document.getElementById('errorMessage');
const loadingOverlay = document.getElementById('loadingOverlay');

const leftContent = document.getElementById('leftContent');
const rightContent = document.getElementById('rightContent');
const leftModelTitle = document.getElementById('leftModelTitle');
const rightModelTitle = document.getElementById('rightModelTitle');
const leftTokens = document.getElementById('leftTokens');
const rightTokens = document.getElementById('rightTokens');
const leftTime = document.getElementById('leftTime');
const rightTime = document.getElementById('rightTime');

// State
let isComparing = false;
let availableModels = [];

/**
 * Initialize application
 */
async function init() {
  try {
    // Fetch available models
    const response = await fetch('/api/models');
    const data = await response.json();
    availableModels = data.models;

    // Populate model dropdowns
    populateModelSelects();

    // Attach event listeners
    compareBtn.addEventListener('click', handleCompare);
    clearBtn.addEventListener('click', handleClear);
    promptInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        handleCompare();
      }
    });
  } catch (error) {
    console.error('Initialization error:', error);
    showError('Failed to initialize application');
  }
}

/**
 * Populate model selection dropdowns
 */
function populateModelSelects() {
  const html = availableModels
    .map((model) => `<option value="${model.id}">${model.name}</option>`)
    .join('');

  leftModelSelect.innerHTML = `<option value="">Select model...</option>${html}`;
  rightModelSelect.innerHTML = `<option value="">Select model...</option>${html}`;

  // Set defaults if available
  if (availableModels.length >= 2) {
    leftModelSelect.value = availableModels[0].id;
    rightModelSelect.value = availableModels[1].id;
  }
}

/**
 * Handle compare button click
 */
async function handleCompare() {
  const prompt = promptInput.value.trim();
  const leftModel = leftModelSelect.value;
  const rightModel = rightModelSelect.value;

  // Validation
  if (!prompt) {
    showError('Please enter a prompt');
    return;
  }

  if (!leftModel) {
    showError('Please select a left model');
    return;
  }

  if (!rightModel) {
    showError('Please select a right model');
    return;
  }

  if (leftModel === rightModel) {
    showError('Please select different models');
    return;
  }

  await performComparison(prompt, leftModel, rightModel);
}

/**
 * Perform the comparison
 */
async function performComparison(prompt, leftModelId, rightModelId) {
  if (isComparing) return;

  isComparing = true;
  compareBtn.disabled = true;
  loadingOverlay.classList.remove('hidden');
  errorSection.classList.add('hidden');
  resultsSection.classList.remove('hidden');

  // Reset content
  leftContent.innerHTML = '<span class="animate-pulse">Waiting for response...</span>';
  rightContent.innerHTML = '<span class="animate-pulse">Waiting for response...</span>';
  leftTokens.textContent = 'Tokens: --';
  rightTokens.textContent = 'Tokens: --';
  leftTime.textContent = 'Time: --ms';
  rightTime.textContent = 'Time: --ms';

  // Update titles
  const leftModelName = availableModels.find((m) => m.id === leftModelId)?.name || leftModelId;
  const rightModelName = availableModels.find((m) => m.id === rightModelId)?.name || rightModelId;
  leftModelTitle.textContent = leftModelName;
  rightModelTitle.textContent = rightModelName;

  try {
    const response = await fetch('/api/compare', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        leftModel: leftModelId,
        rightModel: rightModelId
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Comparison failed');
    }

    // Process Server-Sent Events stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');

      // Keep the last incomplete line in the buffer
      buffer = lines[lines.length - 1];

      // Process complete lines
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];
        if (line.startsWith('data: ')) {
          try {
            const event = JSON.parse(line.slice(6));
            handleStreamEvent(event);
          } catch (e) {
            console.error('Failed to parse event:', e);
          }
        }
      }
    }
  } catch (error) {
    console.error('Comparison error:', error);
    showError(error.message || 'An error occurred during comparison');
  } finally {
    isComparing = false;
    compareBtn.disabled = false;
    loadingOverlay.classList.add('hidden');
  }
}

/**
 * Handle streaming events
 */
function handleStreamEvent(event) {
  switch (event.type) {
    case 'chunk':
      handleChunk(event);
      break;
    case 'metrics':
      handleMetrics(event);
      break;
    case 'error':
      handleStreamError(event);
      break;
    case 'complete':
      handleComplete();
      break;
  }
}

/**
 * Handle chunk events (streamed text)
 */
function handleChunk(event) {
  const { side, content } = event;
  const targetElement = side === 'left' ? leftContent : rightContent;

  // Clear initial loading message
  if (targetElement.textContent.includes('Waiting for response')) {
    targetElement.textContent = '';
  }

  // Append content
  targetElement.textContent += content;

  // Auto-scroll to bottom
  targetElement.parentElement.scrollTop = targetElement.parentElement.scrollHeight;
}

/**
 * Handle metrics events (token count, response time)
 */
function handleMetrics(event) {
  if (event.left) {
    const { tokenCount, duration } = event.left;
    leftTokens.textContent = `Tokens: ${tokenCount}`;
    leftTime.textContent = `Time: ${duration}ms`;
  }

  if (event.right) {
    const { tokenCount, duration } = event.right;
    rightTokens.textContent = `Tokens: ${tokenCount}`;
    rightTime.textContent = `Time: ${duration}ms`;
  }
}

/**
 * Handle stream errors
 */
function handleStreamError(event) {
  const { side, message } = event;
  const targetElement = side === 'left' ? leftContent : rightContent;
  targetElement.innerHTML = `<span class="text-red-600">Error: ${escapeHtml(message)}</span>`;
}

/**
 * Handle comparison complete
 */
function handleComplete() {
  showNotification('Comparison complete');
}

/**
 * Handle clear button
 */
function handleClear() {
  promptInput.value = '';
  resultsSection.classList.add('hidden');
  errorSection.classList.add('hidden');
  leftContent.innerHTML = '';
  rightContent.innerHTML = '';
  promptInput.focus();
}

/**
 * Show error message
 */
function showError(message) {
  errorMessage.textContent = message;
  errorSection.classList.remove('hidden');
  resultsSection.classList.add('hidden');
  loadingOverlay.classList.add('hidden');
  isComparing = false;
  compareBtn.disabled = false;
}

/**
 * Show notification toast
 */
function showNotification(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3001);
}

/**
 * Copy content to clipboard
 */
function copyToClipboard(elementId) {
  const element = document.getElementById(elementId);
  const text = element.textContent;

  if (!text || text.includes('Loading') || text.includes('Waiting')) {
    showNotification('No content to copy');
    return;
  }

  navigator.clipboard
    .writeText(text)
    .then(() => {
      showNotification('Copied to clipboard');
    })
    .catch(() => {
      showNotification('Failed to copy');
    });
}

/**
 * Escape HTML special characters
 */
function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);
