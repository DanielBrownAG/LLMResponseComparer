const axios = require('axios');
const { StringDecoder } = require('node:string_decoder');

// Preserve Unicode characters split across network packets.
async function* readDataLines(source) {
  const decoder = new StringDecoder('utf8');
  let buffer = '';
  const parse = line => line.startsWith('data:') ? line.slice(5).trim() : null;
  for await (const chunk of source) {
    buffer += decoder.write(chunk);
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const data = parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      if (data) yield data;
    }
  }
  buffer += decoder.end();
  const data = parse(buffer);
  if (data) yield data;
}

class AzureService {
  constructor(client = axios) { this.client = client; }

  async *streamCompletion(prompt, modelId, { signal } = {}) {
    const number = { model1: 1, model2: 2 }[modelId];
    if (!number) throw new Error(`Model ${modelId} not configured`);
    const prefix = `MODEL_${number}_`;
    const endpoint = process.env[`${prefix}ENDPOINT`];
    const apiKey = process.env[`${prefix}API_KEY`];
    const deploymentId = process.env[`${prefix}DEPLOYMENT_ID`];
    if (!endpoint || !apiKey || !deploymentId) throw new Error(`Azure ${modelId} configuration incomplete`);
    const apiVersion = process.env[`${prefix}API_VERSION`] || '2025-01-01-preview';
    // Deployment names can be arbitrary; MODEL_n_MODEL identifies the underlying model.
    const model = process.env[`${prefix}MODEL`] || deploymentId;
    const reasoning = /^(gpt-[56]|o[134])/.test(model);
    const body = {
      messages: [{ role: 'user', content: prompt }], stream: true,
      stream_options: { include_usage: true },
      ...(reasoning ? { max_completion_tokens: 16384 } : { max_tokens: 2000, temperature: 0.7 })
    };
    const url = `${endpoint.replace(/\/+$/, '')}/openai/deployments/${encodeURIComponent(deploymentId)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
    const startTime = Date.now();
    const response = await this.client.post(url, body, {
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      responseType: 'stream', timeout: 120000, signal
    });
    let fullContent = '';
    let tokenCount;
    let finished = false;
    try {
      for await (const data of readDataLines(response.data)) {
        if (data === '[DONE]') { finished = true; break; }
        const chunk = JSON.parse(data);
        if (chunk.error) throw new Error(chunk.error.message || 'Azure response failed');
        if (chunk.usage) tokenCount = chunk.usage.completion_tokens;
        const choice = chunk.choices?.[0];
        const content = choice?.delta?.content || choice?.delta?.refusal;
        if (content) { fullContent += content; yield { content }; }
        if (choice?.finish_reason === 'length' || choice?.finish_reason === 'content_filter') {
          throw new Error(`Response incomplete: ${choice.finish_reason}`);
        }
      }
      if (!finished && !signal?.aborted) throw new Error('Azure stream ended before completion');
      yield { metadata: {
        duration: Date.now() - startTime, tokenCount: tokenCount ?? Math.ceil(fullContent.length / 4),
        estimated: tokenCount == null, model, deployment: deploymentId, completed: true
      } };
    } finally {
      response.data.destroy();
    }
  }
}

module.exports = new AzureService();
module.exports.AzureService = AzureService;
module.exports.readDataLines = readDataLines;

