const express = require('express');
const azureService = require('../services/azureService');
const openaiService = require('../services/openaiService');

function getAvailableModels(env = process.env) {
  const models = Object.create(null);
  for (const number of [1, 2]) {
    const prefix = `MODEL_${number}_`;
    if (env[`${prefix}ENDPOINT`] && env[`${prefix}API_KEY`] && env[`${prefix}DEPLOYMENT_ID`]) {
      models[`azure-gpt-4-model-${number}`] = {
        type: 'azure', modelId: `model${number}`,
        name: env[`${prefix}NAME`] || env[`${prefix}DEPLOYMENT_ID`]
      };
    }
  }
  if (env.OPENAI_API_KEY) {
    const ids = (env.OPENAI_MODELS || 'gpt-6-astra,gpt-6-sol,gpt-6-luna').split(',');
    for (const modelId of ids.map(id => id.trim()).filter(Boolean)) {
      models[`openai-${modelId}`] = { type: 'openai', modelId, name: `OpenAI ${modelId}` };
    }
  }
  return models;
}

function createRouter({ models = getAvailableModels(), services = { azure: azureService, openai: openaiService } } = {}) {
  const router = express.Router();
  router.post('/compare', async (req, res) => {
    const { prompt, leftModel, rightModel } = req.body || {};
    if (typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'Valid prompt is required' });
    }
    if (typeof leftModel !== 'string' || typeof rightModel !== 'string' ||
        !Object.hasOwn(models, leftModel) || !Object.hasOwn(models, rightModel)) {
      return res.status(400).json({ error: 'Invalid model selection' });
    }
    if (leftModel === rightModel) return res.status(400).json({ error: 'Models must be different' });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    const controller = new AbortController();
    const onClose = () => controller.abort();
    res.on('close', onClose);
    const send = event => {
      if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const heartbeat = setInterval(() => {
      if (!res.destroyed) res.write(': keep-alive\n\n');
    }, 15000);
    let failed = false;
    async function consume(side, id) {
      const config = models[id];
      try {
        const stream = await services[config.type].streamCompletion(prompt.trim(), config.modelId, { signal: controller.signal });
        for await (const value of stream) {
          if (controller.signal.aborted) break;
          if (value.metadata) send({ type: 'metrics', [side]: value.metadata });
          else if (value.error) {
            failed = true;
            send({ type: 'error', side, message: value.error });
          } else if (value.content) send({ type: 'chunk', side, content: value.content });
        }
      } catch (error) {
        failed = true;
        if (!controller.signal.aborted) send({ type: 'error', side, message: error.message });
      }
    }
    try {
      // Forward each model independently, including while the other is connecting.
      await Promise.all([consume('left', leftModel), consume('right', rightModel)]);
      send({ type: 'complete', success: !failed });
    } finally {
      clearInterval(heartbeat);
      res.off('close', onClose);
      controller.abort();
      res.end();
    }
  });
  router.get('/models', (req, res) => {
    res.json({ models: Object.entries(models).map(([id, config]) => ({ id, name: config.name, type: config.type })) });
  });
  router.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
  return router;
}

module.exports = createRouter();
module.exports.createRouter = createRouter;
module.exports.getAvailableModels = getAvailableModels;
