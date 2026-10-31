const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { Readable } = require('node:stream');
const { createRouter, getAvailableModels } = require('../routes/api');
const { OpenAIService } = require('../services/openaiService');
const { AzureService, readDataLines } = require('../services/azureService');

test('application starts without provider credentials and renders the page', async t => {
  const app = require('../server');
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(url);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /LLM Response Comparer/);
  assert.equal((await (await fetch(`${url}/api/health`)).json()).status, 'ok');
});

async function serve(t, router) {
  const app = express();
  app.use(express.json());
  app.use('/api', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
const models = {
  fast: { type: 'mock', modelId: 'fast', name: 'Fast' },
  slow: { type: 'mock', modelId: 'slow', name: 'Slow' }
};
const request = (url, body, signal) => fetch(`${url}/api/compare`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal
});
const body = { prompt: 'hello', leftModel: 'fast', rightModel: 'slow' };

test('only configured providers appear; OpenAI defaults include GPT-6', () => {
  assert.deepEqual(Object.keys(getAvailableModels({})), []);
  const configured = getAvailableModels({ OPENAI_API_KEY: 'test' });
  assert.equal(configured['openai-gpt-6-astra'].modelId, 'gpt-6-astra');
  assert.equal(Object.keys(configured).length, 3);
  assert.deepEqual(Object.keys(getAvailableModels({ OPENAI_API_KEY: 'test', OPENAI_MODELS: 'gpt-6-astra, gpt-4.1' })),
    ['openai-gpt-6-astra', 'openai-gpt-4.1']);
  const azure = getAvailableModels({ MODEL_1_ENDPOINT: 'url', MODEL_1_API_KEY: 'key', MODEL_1_DEPLOYMENT_ID: 'custom' });
  assert.equal(azure['azure-gpt-4-model-1'].name, 'custom');
});

test('fast output and metrics arrive while the other model is still connecting', { timeout: 5000 }, async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const service = { async streamCompletion(prompt, model) {
    if (model === 'slow') await gate;
    return (async function* () { yield { content: model }; yield { metadata: { tokenCount: 1 } }; })();
  } };
  const url = await serve(t, createRouter({ models, services: { mock: service } }));
  const response = await request(url, body);
  assert.equal(response.headers.get('x-accel-buffering'), 'no');
  const reader = response.body.getReader();
  let text = '';
  while (!text.includes('metrics')) text += new TextDecoder().decode((await reader.read()).value);
  assert.match(text, /"content":"fast"/);
  assert.doesNotMatch(text, /"side":"right"/);
  release();
  while (true) { const next = await reader.read(); if (next.done) break; text += new TextDecoder().decode(next.value); }
  assert.match(text, /"content":"slow"/);
  assert.match(text, /"success":true/);
});

test('a failed model does not interrupt the successful side', async t => {
  const service = { async *streamCompletion(prompt, model) {
    if (model === 'fast') throw new Error('Provider failed');
    yield { content: 'still working' };
  } };
  const url = await serve(t, createRouter({ models, services: { mock: service } }));
  const text = await (await request(url, body)).text();
  assert.match(text, /"type":"error","side":"left"/);
  assert.match(text, /still working/);
  assert.match(text, /"success":false/);
});

test('invalid model IDs including prototype keys are rejected before streaming', async t => {
  const url = await serve(t, createRouter({ models }));
  for (const invalid of [null, 'toString', '__proto__', {}, ['fast']]) {
    assert.equal((await request(url, { ...body, leftModel: invalid })).status, 400);
  }
  assert.equal((await request(url, { ...body, prompt: ' ' })).status, 400);
  assert.equal((await request(url, { ...body, rightModel: 'fast' })).status, 400);
});

test('disconnect aborts both upstream requests', { timeout: 5000 }, async t => {
  let count = 0;
  let finished;
  const aborted = new Promise(resolve => { finished = resolve; });
  const service = { async *streamCompletion(prompt, model, { signal }) {
    yield { content: 'started' };
    await new Promise(resolve => {
      if (signal.aborted) resolve();
      else signal.addEventListener('abort', resolve, { once: true });
    });
    if (++count === 2) finished();
  } };
  const url = await serve(t, createRouter({ models, services: { mock: service } }));
  const controller = new AbortController();
  const response = await request(url, body, controller.signal);
  await response.body.getReader().read();
  controller.abort();
  await aborted;
  assert.equal(count, 2);
});

test('OpenAI Responses streams text and refusal deltas with real token usage and cancellation', async () => {
  let args;
  let stopped = false;
  const controller = new AbortController();
  const service = new OpenAIService({ responses: { create: async (...params) => {
    args = params;
    return Object.assign((async function* () {
      yield { type: 'response.output_text.delta', delta: 'Hello' };
      yield { type: 'response.refusal.delta', delta: ' refusal' };
      yield { type: 'response.completed', response: { usage: { output_tokens: 9 } } };
    })(), { controller: { abort() { stopped = true; } } });
  } } });
  const events = await Array.fromAsync(service.streamCompletion('test', 'gpt-6-astra', { signal: controller.signal }));
  assert.equal(args[0].model, 'gpt-6-astra');
  assert.equal(args[0].stream, true);
  assert.equal(args[0].store, false);
  assert.equal(args[0].temperature, undefined);
  assert.equal(args[1].signal, controller.signal);
  assert.equal(events[0].content, 'Hello');
  assert.equal(events[1].content, ' refusal');
  assert.equal(events[2].metadata.tokenCount, 9);
  assert.equal(stopped, true);
});

test('OpenAI failures, truncation, and unexpected EOF are reported', async () => {
  for (const event of [
    { type: 'response.failed', response: { error: { message: 'failed' } } },
    { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_output_tokens' } } },
    { type: 'error', message: 'failed' },
    { type: 'response.created' }
  ]) {
    const service = new OpenAIService({ responses: { create: async () => (async function* () { yield event; })() } });
    await assert.rejects(Array.fromAsync(service.streamCompletion('test', 'gpt-6-astra')));
  }
});

test('Azure parser preserves split Unicode, CRLF and final unterminated data', async () => {
  const bytes = Buffer.from(': heartbeat\r\ndata:{"text":"🌏"}\r\n\r\ndata: [DONE]');
  const source = Readable.from([...bytes].map(byte => Buffer.from([byte])));
  assert.deepEqual(await Array.fromAsync(readDataLines(source)), ['{"text":"🌏"}', '[DONE]']);
});

test('Azure uses reasoning-compatible parameters, normalizes URL and reads usage', async t => {
  const env = { MODEL_1_ENDPOINT: 'https://example.test/', MODEL_1_API_KEY: 'test',
    MODEL_1_DEPLOYMENT_ID: 'custom deployment', MODEL_1_MODEL: 'gpt-6-astra' };
  for (const [key, value] of Object.entries(env)) {
    const old = process.env[key]; process.env[key] = value;
    t.after(() => { if (old === undefined) delete process.env[key]; else process.env[key] = old; });
  }
  const service = new AzureService({ post: async (url, body) => {
    assert.match(url, /example.test\/openai\/deployments\/custom%20deployment\//);
    assert.equal(body.max_completion_tokens, 16384);
    assert.equal(body.temperature, undefined);
    return { data: Readable.from([Buffer.from('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"usage":{"completion_tokens":7},"choices":[]}\n\ndata: [DONE]\n\n')]) };
  } });
  const events = await Array.fromAsync(service.streamCompletion('test', 'model1'));
  assert.equal(events[0].content, 'Hi');
  assert.equal(events[1].metadata.tokenCount, 7);
  assert.equal(events[1].metadata.estimated, false);
});
