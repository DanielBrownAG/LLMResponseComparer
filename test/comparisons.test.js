const { test } = require('node:test');
const assert = require('node:assert/strict');
const history = require('../public/js/comparisons');

function storage(initial = null) {
  let value = initial;
  return { getItem: () => value, setItem(key, next) { value = next; } };
}

function comparison(id = 'entry-1') {
  return { id, createdAt: '2026-10-31T01:00:00.000Z', prompt: 'Explain 🌏', status: 'complete', error: '',
    left: { modelId: 'left', modelName: 'Left model', content: 'Left output', error: '',
      metrics: { duration: 100, tokenCount: 5, completed: true } },
    right: { modelId: 'right', modelName: 'Right model', content: 'Right output', error: '', metrics: null } };
}

test('storage keeps snapshots, updates without duplicates, and deletes only the selected entry', () => {
  const store = storage();
  const first = comparison();
  history.save(store, first);
  first.left.content = 'Changed in memory';
  assert.equal(history.read(store)[0].left.content, 'Left output');
  history.save(store, comparison('entry-2'));
  history.save(store, first);
  assert.deepEqual(history.read(store).map(item => item.id), ['entry-1', 'entry-2']);
  history.remove(store, 'entry-1');
  assert.deepEqual(history.read(store).map(item => item.id), ['entry-2']);
});

test('corrupt, unsupported, and invalid storage is never silently overwritten', () => {
  for (const raw of ['{bad', '{"version":2,"comparisons":[]}',
    JSON.stringify({ version: 1, comparisons: [{ id: 'invalid' }] }),
    JSON.stringify({ version: 1, comparisons: [comparison(), comparison()] })]) {
    const store = storage(raw);
    assert.throws(() => history.read(store));
    assert.throws(() => history.save(store, comparison('new')));
    assert.throws(() => history.remove(store, 'entry-1'));
    assert.equal(store.getItem(), raw);
  }
});

test('storage limit refuses new entries without deleting existing comparisons', () => {
  const entries = Array.from({ length: history.MAX_SAVED }, (_, index) => comparison(`entry-${index}`));
  const store = storage(JSON.stringify({ version: 1, comparisons: entries }));
  const raw = store.getItem();
  assert.throws(() => history.save(store, comparison('overflow')), /limit reached/);
  assert.equal(store.getItem(), raw);
  history.save(store, comparison('entry-0'));
  assert.equal(history.read(store).length, history.MAX_SAVED);
});

test('failed storage writes preserve existing entries', () => {
  const store = storage();
  history.save(store, comparison());
  const raw = store.getItem();
  store.setItem = () => { throw new Error('Storage blocked'); };
  assert.throws(() => history.save(store, comparison('new')), /full or unavailable/);
  assert.throws(() => history.remove(store, 'entry-1'), /full or unavailable/);
  assert.equal(store.getItem(), raw);
});

test('JSON export includes the full snapshot and a versioned format', () => {
  const saved = comparison();
  saved.status = 'error'; saved.error = 'Connection lost'; saved.right.error = 'Provider error';
  const file = history.exportComparison(saved, 'json');
  assert.deepEqual(JSON.parse(file.content), { version: 1, comparison: saved });
  assert.equal(file.filename, 'comparison-2026-10-31-entry-1.json');
  assert.match(file.mime, /application\/json/);
});

test('Markdown export preserves Unicode, metrics, errors and embedded code fences', () => {
  const saved = comparison();
  saved.prompt = 'A ```fence``` and 🌏';
  saved.left.content = '```js\nexample\n```';
  saved.right.error = 'Provider failed';
  const file = history.exportComparison(saved, 'markdown');
  assert.match(file.content, /````\nA ```fence``` and 🌏\n````/);
  assert.ok(file.content.includes('````\n```js\nexample\n```\n````'));
  assert.match(file.content, /Output tokens: 5/);
  assert.match(file.content, /Duration: 100 ms/);
  assert.match(file.content, /Provider failed/);
  assert.match(file.filename, /\.md$/);
  assert.throws(() => history.exportComparison(saved, 'html'), /Unsupported/);
});

test('blind records preserve votes and block exports before reveal while legacy records still load', () => {
  const saved = comparison();
  const store = storage();
  history.save(store, saved);
  assert.equal(history.read(store)[0].blind, undefined);
  saved.blind = true; saved.revealed = false; saved.vote = null;
  history.save(store, saved);
  for (const format of ['json', 'markdown']) assert.throws(() => history.exportComparison(saved, format), /Vote before exporting/);
  saved.revealed = true; saved.vote = 'tie';
  history.save(store, saved);
  assert.equal(history.read(store)[0].vote, 'tie');
  assert.match(history.exportComparison(saved, 'markdown').content, /Vote: tie/);
  assert.equal(JSON.parse(history.exportComparison(saved, 'json').content).comparison.blind, true);
  saved.vote = 'invalid';
  assert.throws(() => history.save(store, saved), /invalid/);
  assert.equal(history.read(store)[0].vote, 'tie');
});
