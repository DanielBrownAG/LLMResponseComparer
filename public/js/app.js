const promptInput = document.getElementById('prompt');
const leftModelSelect = document.getElementById('leftModel');
const rightModelSelect = document.getElementById('rightModel');
const compareBtn = document.getElementById('compareBtn');
const clearBtn = document.getElementById('clearBtn');
const resultsSection = document.getElementById('resultsSection');
const errorSection = document.getElementById('errorSection');
const errorMessage = document.getElementById('errorMessage');
const loadingOverlay = document.getElementById('loadingOverlay');
const saveComparisonBtn = document.getElementById('saveComparisonBtn');
const exportJsonBtn = document.getElementById('exportJsonBtn');
const exportMarkdownBtn = document.getElementById('exportMarkdownBtn');
const savedComparisons = document.getElementById('savedComparisons');
const savedMessage = document.getElementById('savedMessage');
const blindMode = document.getElementById('blindMode');
const modelSelection = document.getElementById('modelSelection');
const votingSection = document.getElementById('votingSection');
const voteMessage = document.getElementById('voteMessage');
const voteLeftBtn = document.getElementById('voteLeftBtn');
const voteRightBtn = document.getElementById('voteRightBtn');
const voteTieBtn = document.getElementById('voteTieBtn');
const revealFailedBtn = document.getElementById('revealFailedBtn');

const leftContent = document.getElementById('leftContent');
const rightContent = document.getElementById('rightContent');
const leftModelTitle = document.getElementById('leftModelTitle');
const rightModelTitle = document.getElementById('rightModelTitle');
const leftTokens = document.getElementById('leftTokens');
const rightTokens = document.getElementById('rightTokens');
const leftTime = document.getElementById('leftTime');
const rightTime = document.getElementById('rightTime');

let isComparing = false;
let availableModels = [];
let comparisonController = null;
const receivedContent = new Set();
let currentComparison = null;

async function init() {
  voteLeftBtn.addEventListener('click', () => castVote('left'));
  voteRightBtn.addEventListener('click', () => castVote('right'));
  voteTieBtn.addEventListener('click', () => castVote('tie'));
  revealFailedBtn.addEventListener('click', revealFailedComparison);
  saveComparisonBtn.addEventListener('click', saveCurrentComparison);
  exportJsonBtn.addEventListener('click', () => downloadComparison(currentComparison, 'json'));
  exportMarkdownBtn.addEventListener('click', () => downloadComparison(currentComparison, 'markdown'));
  clearBtn.addEventListener('click', handleClear);
  renderSavedComparisons();
  try {
    const response = await fetch('/api/models');
    if (!response.ok) throw new Error('Failed to load models');
    const data = await response.json();
    availableModels = data.models;

    populateModelSelects();
    if (availableModels.length < 2) {
      showError('Configure an OpenAI API key or at least two model deployments, then restart the server.');
    }

    compareBtn.addEventListener('click', handleCompare);
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

function populateModelSelects() {
  for (const select of [leftModelSelect, rightModelSelect]) {
    select.replaceChildren(new Option('Select model...', ''));
    for (const model of availableModels) select.add(new Option(model.name, model.id));
  }

  if (availableModels.length >= 2) {
    leftModelSelect.value = availableModels[0].id;
    rightModelSelect.value = availableModels[1].id;
  }
}

async function handleCompare() {
  if (isComparing) return;
  const prompt = promptInput.value.trim();
  const leftModel = leftModelSelect.value;
  const rightModel = rightModelSelect.value;

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

async function performComparison(prompt, leftModelId, rightModelId) {
  if (isComparing) return;
  const blind = Boolean(blindMode.checked);
  if (blind && Math.random() < 0.5) [leftModelId, rightModelId] = [rightModelId, leftModelId];

  isComparing = true;
  comparisonController = new AbortController();
  receivedContent.clear();
  compareBtn.disabled = true;
  compareBtn.textContent = 'Comparing...';
  loadingOverlay.classList.remove('hidden');
  errorSection.classList.add('hidden');
  resultsSection.classList.remove('hidden');

  leftContent.innerHTML = '<span class="animate-pulse">Waiting for response...</span>';
  rightContent.innerHTML = '<span class="animate-pulse">Waiting for response...</span>';
  leftTokens.textContent = 'Tokens: --';
  rightTokens.textContent = 'Tokens: --';
  leftTime.textContent = 'Time: --ms';
  rightTime.textContent = 'Time: --ms';

  const leftModelName = availableModels.find((m) => m.id === leftModelId)?.name || leftModelId;
  const rightModelName = availableModels.find((m) => m.id === rightModelId)?.name || rightModelId;
  leftModelTitle.textContent = leftModelName;
  rightModelTitle.textContent = rightModelName;
  currentComparison = {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    createdAt: new Date().toISOString(), prompt, status: 'streaming', error: '',
    blind, revealed: !blind, vote: null,
    left: { modelId: leftModelId, modelName: leftModelName, content: '', metrics: null, error: '' },
    right: { modelId: rightModelId, modelName: rightModelName, content: '', metrics: null, error: '' }
  };
  updateComparisonActions();
  renderSavedComparisons();

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

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let completed = false;
    function processLine(line) {
      if (comparisonController.signal.aborted) return;
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
      if (currentComparison) {
        currentComparison.status = 'error';
        currentComparison.error = error.message || 'Comparison failed';
      }
      errorMessage.textContent = isBlindHidden() ? 'Comparison failed. Reveal the comparison to see details.' : error.message || 'An error occurred during comparison';
      errorSection.classList.remove('hidden');
    }
  } finally {
    comparisonController = null;
    isComparing = false;
    compareBtn.disabled = availableModels.length < 2;
    compareBtn.textContent = 'Compare';
    loadingOverlay.classList.add('hidden');
    updateComparisonActions();
    renderSavedComparisons();
  }
}

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

function handleChunk(event) {
  const { side, content } = event;
  if (currentComparison?.[side]) currentComparison[side].content += content;
  const targetElement = side === 'left' ? leftContent : rightContent;

  // Clear initial loading message
  if (!receivedContent.has(side)) {
    targetElement.textContent = '';
    receivedContent.add(side);
  }

  targetElement.textContent += content;

  // Auto-scroll to bottom
  targetElement.parentElement.scrollTop = targetElement.parentElement.scrollHeight;
}

function handleMetrics(event) {
  for (const side of ['left', 'right']) {
    if (event[side] && currentComparison) currentComparison[side].metrics = event[side];
  }
  if (isBlindHidden()) return;
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

function handleStreamError(event) {
  const { side, message } = event;
  if (currentComparison) {
    currentComparison.status = 'error';
    if (side) currentComparison[side].error = message;
    else currentComparison.error = message;
  }
  const displayMessage = isBlindHidden() ? 'Response failed. Reveal the comparison to see details.' : message;
  if (!side) {
    errorMessage.textContent = displayMessage;
    errorSection.classList.remove('hidden');
    return;
  }
  const targetElement = side === 'left' ? leftContent : rightContent;
  if (!receivedContent.has(side)) targetElement.textContent = '';
  receivedContent.add(side);
  const error = document.createElement('span');
  error.className = 'text-red-600';
  error.textContent = `\nError: ${displayMessage}`;
  targetElement.appendChild(error);
}

function handleComplete(event) {
  if (currentComparison && currentComparison.status !== 'error') {
    currentComparison.status = event.success === false ? 'error' : 'complete';
  }
  for (const [side, element] of [['left', leftContent], ['right', rightContent]]) {
    if (!receivedContent.has(side)) element.textContent = 'No text returned';
  }
  showNotification(event.success === false ? 'Comparison finished with errors' : 'Comparison complete');
}

function handleClear() {
  comparisonController?.abort();
  currentComparison = null;
  updateComparisonActions();
  promptInput.value = '';
  resultsSection.classList.add('hidden');
  errorSection.classList.add('hidden');
  leftContent.innerHTML = '';
  rightContent.innerHTML = '';
  promptInput.focus();
}

function showError(message) {
  errorMessage.textContent = message;
  errorSection.classList.remove('hidden');
  resultsSection.classList.add('hidden');
  loadingOverlay.classList.add('hidden');
  compareBtn.disabled = availableModels.length < 2;
}

function showNotification(message) {
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 3001);
}

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

function isBlindHidden() {
  return Boolean(currentComparison?.blind && !currentComparison.revealed);
}

function hasBothResponses() {
  return currentComparison?.status === 'complete' && !currentComparison.error &&
    ['left', 'right'].every(side => currentComparison[side].content.trim() && !currentComparison[side].error);
}

function updateBlindView() {
  const hidden = isBlindHidden();
  modelSelection.classList[hidden ? 'add' : 'remove']('hidden');
  blindMode.disabled = isComparing || hidden;
  votingSection.classList[currentComparison?.blind ? 'remove' : 'add']('hidden');
  if (!currentComparison) return;
  leftModelTitle.textContent = hidden ? 'Response A (left)' : currentComparison.left.modelName;
  rightModelTitle.textContent = hidden ? 'Response B (right)' : currentComparison.right.modelName;
  const canVote = hidden && !isComparing && hasBothResponses();
  for (const button of [voteLeftBtn, voteRightBtn, voteTieBtn]) button.disabled = !canVote;
  const failed = hidden && !isComparing && !hasBothResponses();
  revealFailedBtn.classList[failed ? 'remove' : 'add']('hidden');
  if (currentComparison.vote) voteMessage.textContent = `Vote recorded: ${currentComparison.vote === 'tie' ? 'Tie' : `${currentComparison.vote === 'left' ? 'Left' : 'Right'} is better`}. Model identities revealed.`;
  else if (!hidden) voteMessage.textContent = 'Model identities revealed without a vote.';
  else if (isComparing) voteMessage.textContent = 'Blind comparison in progress. Voting opens when both responses finish.';
  else if (failed) voteMessage.textContent = 'Both responses must finish successfully with text to vote. Reveal details or clear to start again.';
  else voteMessage.textContent = 'Choose the better response or a tie to reveal the models. Clear discards this result.';
}

function persistRevealedComparison() {
  openSavedComparison(currentComparison);
  try {
    if (ComparisonHistory.read(localStorage).some(item => item.id === currentComparison.id)) {
      ComparisonHistory.save(localStorage, currentComparison);
    }
    renderSavedComparisons();
  } catch (error) {
    savedMessage.textContent = `Result updated in this view, but could not update storage: ${error.message}`;
  }
}

function castVote(vote) {
  if (!['left', 'right', 'tie'].includes(vote) || isComparing || !isBlindHidden() || !hasBothResponses()) return;
  currentComparison.vote = vote;
  currentComparison.revealed = true;
  persistRevealedComparison();
}

function revealFailedComparison() {
  if (isComparing || !isBlindHidden() || hasBothResponses()) return;
  currentComparison.revealed = true;
  persistRevealedComparison();
}

function updateComparisonActions() {
  const disabled = isComparing || !currentComparison || currentComparison.status === 'streaming';
  for (const button of [saveComparisonBtn, exportJsonBtn, exportMarkdownBtn]) button.disabled = disabled;
  if (isBlindHidden()) {
    exportJsonBtn.disabled = true;
    exportMarkdownBtn.disabled = true;
  }
  updateBlindView();
}

function saveCurrentComparison() {
  if (isComparing || !currentComparison) return;
  try {
    ComparisonHistory.save(localStorage, currentComparison);
    renderSavedComparisons();
    showNotification('Comparison saved in this browser');
  } catch (error) {
    savedMessage.textContent = error.message;
  }
}

function renderSavedComparisons() {
  savedComparisons.replaceChildren();
  try {
    const comparisons = ComparisonHistory.read(localStorage);
    savedMessage.textContent = comparisons.length ? `${comparisons.length} saved` : 'No saved comparisons yet.';
    for (const comparison of comparisons) {
      const row = document.createElement('li');
      row.className = 'border border-gray-200 rounded-lg p-4';
      const title = document.createElement('p');
      title.className = 'font-semibold whitespace-pre-wrap break-words';
      title.textContent = comparison.prompt.length > 120 ? comparison.prompt.slice(0, 120) + '…' : comparison.prompt;
      const details = document.createElement('p');
      details.className = 'text-sm text-gray-600 mt-1 break-words';
      const names = comparison.blind && !comparison.revealed ? 'Blind comparison — not revealed' : `${comparison.left.modelName} / ${comparison.right.modelName}`;
      details.textContent = `${new Date(comparison.createdAt).toLocaleString()} · ${names} · ${comparison.status === 'error' ? 'With errors' : 'Complete'}${comparison.vote ? ` · Vote: ${comparison.vote}` : ''}`;
      const actions = document.createElement('div');
      actions.className = 'flex flex-wrap gap-3 mt-3';
      const addAction = (label, action, disabled = false) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'px-3 py-1 border rounded text-sm disabled:opacity-50';
        button.textContent = label;
        button.disabled = disabled;
        button.addEventListener('click', action);
        actions.appendChild(button);
      };
      addAction('Open', () => openSavedComparison(comparison), isComparing);
      addAction('Export JSON', () => downloadComparison(comparison, 'json'), comparison.blind && !comparison.revealed);
      addAction('Export Markdown', () => downloadComparison(comparison, 'markdown'), comparison.blind && !comparison.revealed);
      addAction('Delete', () => {
        try {
          ComparisonHistory.remove(localStorage, comparison.id);
          renderSavedComparisons();
        } catch (error) { savedMessage.textContent = error.message; }
      });
      row.appendChild(title);
      row.appendChild(details);
      row.appendChild(actions);
      savedComparisons.appendChild(row);
    }
  } catch (error) {
    savedMessage.textContent = `Saved comparisons unavailable: ${error.message}`;
  }
}

function openSavedComparison(comparison) {
  if (isComparing) return;
  // Keep the stored snapshot separate from the currently displayed result.
  currentComparison = JSON.parse(JSON.stringify(comparison));
  blindMode.checked = Boolean(comparison.blind);
  receivedContent.clear();
  promptInput.value = comparison.prompt;
  errorSection.classList.add('hidden');
  resultsSection.classList.remove('hidden');
  for (const side of ['left', 'right']) {
    const result = comparison[side];
    const content = side === 'left' ? leftContent : rightContent;
    const select = side === 'left' ? leftModelSelect : rightModelSelect;
    select.value = availableModels.some(model => model.id === result.modelId) ? result.modelId : '';
    (side === 'left' ? leftModelTitle : rightModelTitle).textContent = result.modelName;
    content.textContent = result.content || 'No text returned';
    if (result.content) receivedContent.add(side);
    (side === 'left' ? leftTokens : rightTokens).textContent = 'Tokens: --';
    (side === 'left' ? leftTime : rightTime).textContent = 'Time: --ms';
    if (result.metrics) handleMetrics({ [side]: result.metrics });
    if (result.error) handleStreamError({ side, message: result.error });
  }
  if (comparison.error) handleStreamError({ message: comparison.error });
  updateComparisonActions();
}

function downloadComparison(comparison, format) {
  if (!comparison || comparison.status === 'streaming') return;
  let url;
  let link;
  try {
    const file = ComparisonHistory.exportComparison(comparison, format);
    url = URL.createObjectURL(new Blob([file.content], { type: file.mime }));
    link = document.createElement('a');
    link.href = url;
    link.download = file.filename;
    document.body.appendChild(link);
    link.click();
  } catch (error) {
    savedMessage.textContent = `Export failed: ${error.message}`;
  } finally {
    link?.remove();
    if (url) setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

document.addEventListener('DOMContentLoaded', init);
