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
let comparisonController = null;
const receivedContent = new Set();

/**
 * Initialize application
 */
async function init() {
  try {
    // Fetch available models
    const response = await fetch('/api/models');
    if (!response.ok) throw new Error('Failed to load models');
    const data = await response.json();
    availableModels = data.models;

    // Populate model dropdowns
    populateModelSelects();
    if (availableModels.length < 2) {
      showError('Configure an OpenAI API key or at least two model deployments, then restart the server.');
    }

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
  for (const select of [leftModelSelect, rightModelSelect]) {
    select.replaceChildren(new Option('Select model...', ''));
    for (const model of availableModels) select.add(new Option(model.name, model.id));
  }

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
  if (isComparing) return;
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
  comparisonController = new AbortController();
  receivedContent.clear();
  compareBtn.disabled = true;
  compareBtn.textContent = 'Comparing...';
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
      signal: comparisonController.signal,
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
    let completed = false;
    function processLine(line) {
      if (!line.startsWith('data:')) return;
      const event = JSON.parse(line.slice(5).trim());
      if (event.type === 'complete') completed = true;
      handleStreamEvent(event);
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          buffer += decoder.decode();
          if (buffer.trim()) processLine(buffer);
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');

        // Keep the last incomplete line in the buffer.
        buffer = lines[lines.length - 1];

        for (let i = 0; i < lines.length - 1; i++) {
          processLine(lines[i]);
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (!completed) throw new Error('Connection closed before comparison completed');
  } catch (error) {
    if (error.name !== 'AbortError') {
      errorMessage.textContent = error.message || 'An error occurred during comparison';
      errorSection.classList.remove('hidden');
    }
  } finally {
    comparisonController = null;
    isComparing = false;
    compareBtn.disabled = availableModels.length < 2;
    compareBtn.textContent = 'Compare';
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
      handleComplete(event);
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
  if (!receivedContent.has(side)) {
    targetElement.textContent = '';
    receivedContent.add(side);
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
    leftTokens.textContent = `Tokens: ${event.left.estimated ? '~' : ''}${tokenCount ?? '--'}`;
    leftTime.textContent = `Time: ${duration}ms`;
  }

  if (event.right) {
    const { tokenCount, duration } = event.right;
    rightTokens.textContent = `Tokens: ${event.right.estimated ? '~' : ''}${tokenCount ?? '--'}`;
    rightTime.textContent = `Time: ${duration}ms`;
  }
}

/**
 * Handle stream errors
 */
function handleStreamError(event) {
  const { side, message } = event;
  if (!side) {
    errorMessage.textContent = message;
    errorSection.classList.remove('hidden');
    return;
  }
  const targetElement = side === 'left' ? leftContent : rightContent;
  if (!receivedContent.has(side)) targetElement.textContent = '';
  receivedContent.add(side);
  const error = document.createElement('span');
  error.className = 'text-red-600';
  error.textContent = `\nError: ${message}`;
  targetElement.appendChild(error);
}

/**
 * Handle comparison complete
 */
function handleComplete(event) {
  for (const [side, element] of [['left', leftContent], ['right', rightContent]]) {
    if (!receivedContent.has(side)) element.textContent = 'No text returned';
  }
  showNotification(event.success === false ? 'Comparison finished with errors' : 'Comparison complete');
}

/**
 * Handle clear button
 */
function handleClear() {
  comparisonController?.abort();
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
  compareBtn.disabled = availableModels.length < 2;
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

  if (!text || !receivedContent.has(elementId === 'leftContent' ? 'left' : 'right')) {
    showNotification('No content to copy');
    return;
  }

  if (!navigator.clipboard) {
    showNotification('Clipboard is unavailable in this browser');
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

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', init);
