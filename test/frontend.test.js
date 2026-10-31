const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function frontend(fetch, storage = memoryStorage()) {
  const elements = new Map();
  const downloads = [];
  const blobs = [];
  const revoked = [];
  const timers = [];
  function element() {
    return { textContent: '', innerHTML: '', disabled: false, children: [], listeners: {},
      classList: { add() {}, remove() {} },
      parentElement: {}, appendChild(child) { this.children.push(child); this.textContent += child.textContent; },
      replaceChildren(...children) { this.children = []; this.textContent = ''; children.forEach(child => this.appendChild(child)); },
      add(child) { this.children.push(child); },
      addEventListener(type, listener) { this.listeners[type] = listener; },
      click() { if (this.download) downloads.push({ filename: this.download, url: this.href }); this.listeners.click?.(); },
      remove() {}, focus() {} };
  }
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    addEventListener() {}, createElement: element, body: { appendChild() {} }
  };
  const context = vm.createContext({ document, fetch, TextDecoder, AbortController, console, Blob,
    Option: function (label, value) { this.textContent = label; this.value = value; },
    localStorage: storage, navigator: {}, setTimeout(callback) { timers.push(callback); },
    URL: { createObjectURL(blob) { blobs.push(blob); return `blob:${blobs.length}`; },
      revokeObjectURL(url) { revoked.push(url); } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/comparisons.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8'), context);
  return { context, elements, storage, downloads, blobs, revoked, timers };
}

function memoryStorage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

function streamResponse(events) {
  let sent = false;
  return { ok: true, body: { getReader: () => ({
    async read() {
      if (sent) return { done: true };
      sent = true;
      return { done: false, value: new TextEncoder().encode(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('')) };
    }, async cancel() {}, releaseLock() {}
  }) } };
}

const completedEvents = [
  { type: 'chunk', side: 'left', content: 'Left answer 🌏' },
  { type: 'chunk', side: 'right', content: 'Right answer' },
  { type: 'metrics', left: { duration: 100, tokenCount: 7, completed: true },
    right: { duration: 200, tokenCount: 9, estimated: true, completed: true } },
  { type: 'complete', success: true }
];

test('streamed text containing the old loading placeholder is never erased', () => {
  const { context, elements } = frontend();
  context.handleChunk({ side: 'left', content: 'Waiting for response is an example. ' });
  context.handleChunk({ side: 'left', content: 'Keep it.' });
  assert.equal(elements.get('leftContent').textContent, 'Waiting for response is an example. Keep it.');
});

test('side errors preserve partial output and global errors use the error banner', () => {
  const { context, elements } = frontend();
  context.handleChunk({ side: 'left', content: 'Partial answer' });
  context.handleStreamError({ side: 'left', message: '<provider error>' });
  assert.equal(elements.get('leftContent').textContent, 'Partial answer\nError: <provider error>');
  context.handleStreamError({ message: 'Connection failed' });
  assert.equal(elements.get('errorMessage').textContent, 'Connection failed');
  assert.equal(elements.get('rightContent').textContent, '');
});

test('browser decodes byte-split Unicode and a final SSE event without newline', async () => {
  const bytes = new TextEncoder().encode('data: {"type":"chunk","side":"left","content":"🌏"}\n\ndata: {"type":"complete","success":true}');
  let index = 0;
  const { context, elements } = frontend(async () => ({ ok: true, body: {
    getReader: () => ({
      async read() { return index < bytes.length ? { value: bytes.slice(index, ++index), done: false } : { done: true }; },
      async cancel() {}, releaseLock() {}
    })
  } }));
  await context.performComparison('prompt', 'left', 'right');
  assert.equal(elements.get('leftContent').textContent, '🌏');
  assert.equal(elements.get('compareBtn').textContent, 'Compare');
  assert.equal(elements.get('errorMessage').textContent, '');
});

test('browser reports a dropped stream without a completion event', async () => {
  const { context, elements } = frontend(async () => ({ ok: true, body: {
    getReader: () => ({ async read() { return { done: true }; }, async cancel() {}, releaseLock() {} })
  } }));
  await context.performComparison('prompt', 'left', 'right');
  assert.equal(elements.get('errorMessage').textContent, 'Connection closed before comparison completed');
});

test('finished comparisons save only on request, survive reload, reopen and delete', async () => {
  const app = frontend(async () => streamResponse(completedEvents));
  await app.context.performComparison('Saved prompt', 'old-left', 'old-right');
  assert.equal(app.context.ComparisonHistory.read(app.storage).length, 0);
  assert.equal(app.elements.get('saveComparisonBtn').disabled, false);
  app.context.saveCurrentComparison();
  app.context.saveCurrentComparison();
  const saved = app.context.ComparisonHistory.read(app.storage);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].prompt, 'Saved prompt');
  assert.equal(saved[0].left.content, 'Left answer 🌏');
  assert.equal(saved[0].right.metrics.tokenCount, 9);
  assert.equal(saved[0].left.modelId, 'old-left');

  const reloaded = frontend(() => { throw new Error('Opening must not call the provider'); }, app.storage);
  reloaded.context.renderSavedComparisons();
  const row = reloaded.elements.get('savedComparisons').children[0];
  row.children[2].children[0].click();
  assert.equal(reloaded.elements.get('prompt').value, 'Saved prompt');
  assert.equal(reloaded.elements.get('leftContent').textContent, 'Left answer 🌏');
  assert.equal(reloaded.elements.get('leftModelTitle').textContent, 'old-left');
  assert.equal(reloaded.elements.get('rightTokens').textContent, 'Tokens: ~9');
  assert.equal(reloaded.elements.get('leftModel').value, '');
  row.children[2].children[3].click();
  assert.equal(reloaded.context.ComparisonHistory.read(app.storage).length, 0);
  assert.equal(reloaded.elements.get('savedComparisons').children.length, 0);
});

test('download uses a Blob with full comparison JSON and releases the object URL', async () => {
  const app = frontend(async () => streamResponse(completedEvents));
  await app.context.performComparison('Export prompt', 'left', 'right');
  app.context.saveCurrentComparison();
  const saved = app.context.ComparisonHistory.read(app.storage)[0];
  app.context.downloadComparison(saved, 'json');
  assert.equal(app.downloads.length, 1);
  assert.match(app.downloads[0].filename, /^comparison-.*\.json$/);
  const exported = JSON.parse(await app.blobs[0].text());
  assert.equal(exported.version, 1);
  assert.equal(exported.comparison.prompt, 'Export prompt');
  assert.equal(exported.comparison.left.content, 'Left answer 🌏');
  assert.equal(exported.comparison.right.metrics.duration, 200);
  app.timers.forEach(callback => callback());
  assert.deepEqual(app.revoked, ['blob:1']);
});

test('storage failure leaves the result exportable and reports the error', async () => {
  const app = frontend(async () => streamResponse(completedEvents), {
    getItem: () => null, setItem() { throw new Error('QuotaExceededError'); }
  });
  await app.context.performComparison('prompt', 'left', 'right');
  app.context.saveCurrentComparison();
  assert.match(app.elements.get('savedMessage').textContent, /storage is full or unavailable/);
  assert.equal(app.elements.get('exportMarkdownBtn').disabled, false);
  app.context.downloadComparison(vm.runInContext('currentComparison', app.context), 'markdown');
  assert.match(await app.blobs[0].text(), /Left answer 🌏/);
});

test('provider errors preserve raw partial output and error details in saved records', async () => {
  const app = frontend(async () => streamResponse([
    completedEvents[0], { type: 'error', side: 'left', message: 'Provider failed' },
    completedEvents[1], { type: 'complete', success: false }
  ]));
  await app.context.performComparison('prompt', 'left', 'right');
  app.context.saveCurrentComparison();
  const saved = app.context.ComparisonHistory.read(app.storage)[0];
  assert.equal(saved.status, 'error');
  assert.equal(saved.left.content, 'Left answer 🌏');
  assert.equal(saved.left.error, 'Provider failed');
  app.context.openSavedComparison(saved);
  assert.equal(app.elements.get('leftContent').textContent, 'Left answer 🌏\nError: Provider failed');
});

test('opening is blocked during streaming and Clear prevents saving a cancelled run', async () => {
  const app = frontend(async () => streamResponse(completedEvents));
  await app.context.performComparison('first', 'left', 'right');
  app.context.saveCurrentComparison();
  const saved = app.context.ComparisonHistory.read(app.storage)[0];
  let abort;
  app.context.fetch = (url, { signal }) => new Promise((resolve, reject) => {
    abort = () => reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    signal.addEventListener('abort', abort, { once: true });
  });
  const pending = app.context.performComparison('second', 'left', 'right');
  assert.equal(app.elements.get('saveComparisonBtn').disabled, true);
  app.context.openSavedComparison(saved);
  assert.equal(vm.runInContext('currentComparison.prompt', app.context), 'second');
  app.context.handleClear();
  await pending;
  app.context.saveCurrentComparison();
  assert.equal(app.context.ComparisonHistory.read(app.storage).length, 1);
  assert.equal(app.elements.get('saveComparisonBtn').disabled, true);
});

test('saved prompt markup is displayed as literal text', async () => {
  const app = frontend(async () => streamResponse(completedEvents));
  const prompt = '<img src=x onerror=alert(1)>';
  await app.context.performComparison(prompt, 'left', 'right');
  app.context.saveCurrentComparison();
  const title = app.elements.get('savedComparisons').children[0].children[0];
  assert.equal(title.textContent, prompt);
  assert.equal(title.innerHTML, '');
});

test('page initialization wires save and export actions and restores configured model selections', async () => {
  const app = frontend(async url => url === '/api/models' ? { ok: true, async json() {
    return { models: [{ id: 'left', name: 'Left configured' }, { id: 'right', name: 'Right configured' }] };
  } } : streamResponse(completedEvents));
  await app.context.init();
  app.elements.get('prompt').value = 'Original prompt';
  await app.elements.get('compareBtn').listeners.click();
  app.elements.get('prompt').value = 'Edited after completion';
  app.elements.get('saveComparisonBtn').click();
  const saved = app.context.ComparisonHistory.read(app.storage)[0];
  assert.equal(saved.prompt, 'Original prompt');
  assert.equal(saved.left.modelName, 'Left configured');
  app.elements.get('exportJsonBtn').click();
  assert.equal(app.downloads.length, 1);
  app.context.handleClear();
  app.elements.get('savedComparisons').children[0].children[2].children[0].click();
  assert.equal(app.elements.get('prompt').value, 'Original prompt');
  assert.equal(app.elements.get('leftModel').value, 'left');
  assert.equal(app.elements.get('rightModel').value, 'right');
  assert.equal(app.elements.get('saveComparisonBtn').disabled, false);
});

test('saved entries remain usable when model discovery is unavailable', async () => {
  const app = frontend(async () => streamResponse(completedEvents));
  await app.context.performComparison('Offline history', 'left', 'right');
  app.context.saveCurrentComparison();
  const offline = frontend(async () => ({ ok: false }), app.storage);
  // Suppress the expected initialization log for this failed discovery request.
  offline.context.console = { error() {} };
  await offline.context.init();
  const actions = offline.elements.get('savedComparisons').children[0].children[2].children;
  actions[0].click();
  assert.equal(offline.elements.get('prompt').value, 'Offline history');
  actions[1].click();
  assert.equal(offline.downloads.length, 1);
  actions[3].click();
  assert.equal(offline.context.ComparisonHistory.read(app.storage).length, 0);
});
