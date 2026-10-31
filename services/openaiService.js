const OpenAI = require('openai');

class OpenAIService {
  constructor(client) { this.client = client; }

  async *streamCompletion(prompt, model, { signal } = {}) {
    if (!this.client) {
      if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not configured');
      this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, timeout: 120000, maxRetries: 0 });
    }
    const startTime = Date.now();
    const stream = await this.client.responses.create({
      model, input: prompt, stream: true, store: false, max_output_tokens: 16384
    }, { signal });
    let completed = false;
    try {
      for await (const event of stream) {
        if (event.type === 'response.output_text.delta' || event.type === 'response.refusal.delta') {
          yield { content: event.delta };
        } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
          completed = true;
          yield { metadata: {
            duration: Date.now() - startTime,
            tokenCount: event.response.usage?.output_tokens ?? null,
            model, completed: event.type === 'response.completed'
          } };
          if (event.type === 'response.incomplete') {
            throw new Error(`Response incomplete: ${event.response.incomplete_details?.reason || 'unknown reason'}`);
          }
        } else if (event.type === 'response.failed' || event.type === 'error') {
          throw new Error(event.response?.error?.message || event.message || 'OpenAI response failed');
        }
      }
      if (!completed && !signal?.aborted) throw new Error('OpenAI stream ended before completion');
    } finally {
      stream.controller?.abort();
    }
  }
}

module.exports = new OpenAIService();
module.exports.OpenAIService = OpenAIService;
