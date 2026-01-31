const OpenAI = require('openai');

class OpenAIService {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY not set in environment variables');
    }
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });
  }

  /**
   * Stream completion from OpenAI
   * @param {string} prompt - User prompt
   * @param {string} model - Model identifier (e.g., 'gpt-4o', 'gpt-4-turbo')
   * @returns {Promise} Stream iterator
   */
  async streamCompletion(prompt, model) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Invalid prompt provided');
    }

    const startTime = Date.now();
    let tokenCount = 0;
    let fullContent = '';

    try {
      const stream = await this.client.chat.completions.create({
        model,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        stream: true,
        max_tokens: 2000,
        temperature: 0.7
      });

      return {
        async *[Symbol.asyncIterator]() {
          try {
            for await (const chunk of stream) {
              if (chunk.choices[0]?.delta?.content) {
                const content = chunk.choices[0].delta.content;
                fullContent += content;
                yield {
                  content,
                  timestamp: Date.now()
                };
              }
            }

            // Estimate token count (approximation: 1 token ≈ 4 chars)
            tokenCount = Math.ceil(fullContent.length / 4);

            yield {
              metadata: {
                duration: Date.now() - startTime,
                tokenCount,
                model,
                completed: true
              }
            };
          } catch (error) {
            yield {
              error: error.message,
              timestamp: Date.now()
            };
          }
        }
      };
    } catch (error) {
      throw new Error(`OpenAI API error: ${error.message}`);
    }
  }
}

module.exports = new OpenAIService();
