const axios = require('axios');

class AzureService {
  constructor() {
    // Load Azure configurations from environment
    this.configs = {
      model1: {
        endpoint: process.env.MODEL_1_ENDPOINT,
        apiKey: process.env.MODEL_1_API_KEY,
        deploymentId: process.env.MODEL_1_DEPLOYMENT_ID,
        apiVersion: process.env.MODEL_1_API_VERSION || '2025-01-01-preview'
      },
      model2: {
        endpoint: process.env.MODEL_2_ENDPOINT,
        apiKey: process.env.MODEL_2_API_KEY,
        deploymentId: process.env.MODEL_2_DEPLOYMENT_ID,
        apiVersion: process.env.MODEL_2_API_VERSION || '2025-01-01-preview'
      }
    };

    // Validate configs
    for (const [key, config] of Object.entries(this.configs)) {
      if (!config.endpoint || !config.apiKey || !config.deploymentId) {
        throw new Error(`Azure OpenAI ${key} configuration incomplete. Check environment variables.`);
      }
    }
  }

  /**
   * Stream completion from Azure OpenAI
   * @param {string} prompt - User prompt
   * @param {string} modelId - Model identifier (model1 or model2)
   * @returns {Promise} Stream iterator
   */
  async streamCompletion(prompt, modelId) {
    if (!prompt || typeof prompt !== 'string') {
      throw new Error('Invalid prompt provided');
    }

    if (!this.configs[modelId]) {
      throw new Error(`Model ${modelId} not configured`);
    }

    const config = this.configs[modelId];
    const startTime = Date.now();
    let tokenCount = 0;
    let fullContent = '';

    try {
      const url = `${config.endpoint}/openai/deployments/${config.deploymentId}/chat/completions?api-version=${config.apiVersion}`;

      const client = axios.create({
        headers: {
          'api-key': config.apiKey,
          'Content-Type': 'application/json'
        }
      });

      const response = await client.post(
        url,
        {
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          stream: true,
          max_tokens: 2000,
          temperature: 0.7
        },
        {
          responseType: 'stream',
          timeout: 60000
        }
      );

      return {
        async *[Symbol.asyncIterator]() {
          try {
            let buffer = '';

            for await (const chunk of response.data) {
              buffer += chunk.toString('utf-8');
              const lines = buffer.split('\n');

              // Process complete lines
              for (let i = 0; i < lines.length - 1; i++) {
                const line = lines[i].trim();
                if (line.startsWith('data: ')) {
                  const jsonStr = line.slice(6);
                  if (jsonStr === '[DONE]') continue;

                  try {
                    const data = JSON.parse(jsonStr);
                    if (data.choices?.[0]?.delta?.content) {
                      const content = data.choices[0].delta.content;
                      fullContent += content;
                      yield {
                        content,
                        timestamp: Date.now()
                      };
                    }
                  } catch (e) {
                    // Skip invalid JSON lines
                  }
                }
              }

              // Keep incomplete line in buffer
              buffer = lines[lines.length - 1];
            }

            // Estimate token count
            tokenCount = Math.ceil(fullContent.length / 4);

            yield {
              metadata: {
                duration: Date.now() - startTime,
                tokenCount,
                model: modelId,
                deployment: config.deploymentId,
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
      throw new Error(`Azure OpenAI API error: ${error.message}`);
    }
  }
}

module.exports = new AzureService();

