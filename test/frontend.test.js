const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

function frontend(fetch) {
  const elements = new Map();
  function element() {
    return { textContent: '', innerHTML: '', disabled: false,
      classList: { add() {}, remove() {} },
      parentElement: {}, appendChild(child) { this.textContent += child.textContent; },
      remove() {}, focus() {} };
  }
  const document = {
    getElementById(id) { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); },
    addEventListener() {}, createElement: element, body: { appendChild() {} }
  };
  const context = vm.createContext({ document, fetch, TextDecoder, AbortController, console,
    navigator: {}, setTimeout() {} });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/app.js'), 'utf8'), context);
  return { context, elements };
}

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
