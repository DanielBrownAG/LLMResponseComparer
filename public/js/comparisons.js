(function (root) {
  const STORAGE_KEY = 'llm-response-comparer.saved.v1';
  const MAX_SAVED = 100;

  function validate(comparison) {
    const text = value => typeof value === 'string';
    const metrics = value => value === null || (value && typeof value === 'object' &&
      Number.isFinite(value.duration) && value.duration >= 0 &&
      (value.tokenCount === null || (Number.isFinite(value.tokenCount) && value.tokenCount >= 0)));
    const side = value => value && text(value.modelId) && text(value.modelName) &&
      text(value.content) && text(value.error) && metrics(value.metrics);
    if (!comparison || !text(comparison.id) || !comparison.id ||
        !text(comparison.createdAt) || !Number.isFinite(Date.parse(comparison.createdAt)) ||
        !text(comparison.prompt) || !text(comparison.error) ||
        !['complete', 'error'].includes(comparison.status) ||
        !side(comparison.left) || !side(comparison.right) ||
        (comparison.blind !== undefined && typeof comparison.blind !== 'boolean') ||
        (comparison.revealed !== undefined && typeof comparison.revealed !== 'boolean') ||
        (comparison.vote != null && !['left', 'right', 'tie'].includes(comparison.vote)) ||
        (comparison.blind && comparison.vote != null &&
          (!comparison.revealed || comparison.status !== 'complete'))) {
      throw new Error('Saved comparison data is invalid; existing storage has been left unchanged.');
    }
    return comparison;
  }

  function read(storage) {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return [];
    let data;
    try { data = JSON.parse(raw); } catch {
      throw new Error('Saved comparison data is unreadable; existing storage has been left unchanged.');
    }
    if (data?.version !== 1 || !Array.isArray(data.comparisons)) {
      throw new Error('Saved comparison storage has an unsupported format.');
    }
    const comparisons = data.comparisons.map(validate);
    if (new Set(comparisons.map(item => item.id)).size !== comparisons.length) {
      throw new Error('Saved comparison storage contains duplicate IDs.');
    }
    return comparisons;
  }

  function write(storage, comparisons) {
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, comparisons }));
    } catch {
      throw new Error('Could not save changes: browser storage is full or unavailable. You can still export this comparison.');
    }
  }

  function save(storage, comparison) {
    validate(comparison);
    const existing = read(storage);
    const others = existing.filter(item => item.id !== comparison.id);
    if (others.length >= MAX_SAVED) throw new Error(`Saved comparison limit reached (${MAX_SAVED}). Delete an entry or export this result.`);
    write(storage, [comparison, ...others]);
  }

  function remove(storage, id) {
    const existing = read(storage);
    write(storage, existing.filter(item => item.id !== id));
  }

  function exportComparison(comparison, format) {
    validate(comparison);
    if (comparison.blind && !comparison.revealed) throw new Error('Vote before exporting this blind comparison. Failed comparisons can be revealed without a vote.');
    const filename = `comparison-${new Date(comparison.createdAt).toISOString().slice(0, 10)}-${comparison.id.replace(/[^a-z0-9-]/gi, '').slice(0, 12)}`;
    if (format === 'json') {
      return { filename: `${filename}.json`, mime: 'application/json;charset=utf-8',
        content: JSON.stringify({ version: 1, comparison }, null, 2) + '\n' };
    }
    if (format !== 'markdown') throw new Error('Unsupported export format');
    const escape = value => value.replace(/[\\`*_[\]<>#|]/g, '\\$&').replace(/[\r\n]/g, ' ');
    // Use a longer fence than any in the text so arbitrary responses stay literal.
    const block = value => {
      const longest = (value.match(/`+/g) || []).reduce((max, run) => Math.max(max, run.length), 2);
      const fence = '`'.repeat(longest + 1);
      return `${fence}\n${value}\n${fence}`;
    };
    const lines = ['# Saved comparison', '', `Date: ${new Date(comparison.createdAt).toISOString()}`,
      `Status: ${comparison.status}`, '', '## Prompt', '', block(comparison.prompt)];
    if (comparison.blind) lines.splice(4, 0, `Blind comparison: yes`, `Vote: ${comparison.vote || 'not cast'}`);
    if (comparison.error) lines.push('', '## Comparison error', '', block(comparison.error));
    for (const side of ['left', 'right']) {
      const result = comparison[side];
      lines.push('', `## ${side === 'left' ? 'Left' : 'Right'}: ${escape(result.modelName)}`,
        '', `Model ID: ${escape(result.modelId)}`);
      if (result.metrics) {
        lines.push(`Output tokens: ${result.metrics.estimated ? '~' : ''}${result.metrics.tokenCount ?? 'unavailable'}`,
          `Duration: ${result.metrics.duration} ms`);
      }
      lines.push('', block(result.content));
      if (result.error) lines.push('', 'Error:', '', block(result.error));
    }
    return { filename: `${filename}.md`, mime: 'text/markdown;charset=utf-8', content: lines.join('\n') + '\n' };
  }

  const api = { STORAGE_KEY, MAX_SAVED, read, save, remove, exportComparison };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ComparisonHistory = api;
})(globalThis);
