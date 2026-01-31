const express = require('express');
const router = express.Router();
const azureService = require('../services/azureService');

// Model configuration - Read from environment variables
const AVAILABLE_MODELS = {
  'azure-gpt-4-model-1': {
    type: 'azure',
    modelId: 'model1',
    name: process.env.MODEL_1_NAME
  },
  'azure-gpt-4-model-2': {
    type: 'azure',
    modelId: 'model2',
    name: process.env.MODEL_2_NAME
  }
};

/**
 * POST /api/compare
 * Compare responses from two Azure OpenAI models
 * Body: { prompt, leftModel, rightModel }
 */
router.post('/compare', async (req, res) => {
  const { prompt, leftModel, rightModel } = req.body;

  // Validation
  if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
    return res.status(400).json({ error: 'Valid prompt is required' });
  }

  if (!leftModel || !rightModel) {
    return res.status(400).json({ error: 'Both models must be specified' });
  }

  if (leftModel === rightModel) {
    return res.status(400).json({ error: 'Models must be different' });
  }

  if (!AVAILABLE_MODELS[leftModel] || !AVAILABLE_MODELS[rightModel]) {
    return res.status(400).json({ error: 'Invalid model selection' });
  }

  // Set SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    // Start both streams in parallel
    const leftConfig = AVAILABLE_MODELS[leftModel];
    const rightConfig = AVAILABLE_MODELS[rightModel];

    const leftPromise = getModelStream(leftConfig, prompt, 'left');
    const rightPromise = getModelStream(rightConfig, prompt, 'right');

    const [leftStream, rightStream] = await Promise.all([leftPromise, rightPromise]);

    // Process both streams concurrently
    await processStreams(res, leftStream, rightStream);

    res.write(`data: ${JSON.stringify({ type: 'complete' })}\n\n`);
    res.end();
  } catch (error) {
    console.error('Comparison error:', error);
    res.write(`data: ${JSON.stringify({ type: 'error', message: error.message })}\n\n`);
    res.end();
  }
});

/**
 * Get model stream based on configuration
 */
async function getModelStream(config, prompt, side) {
  try {
    if (config.type === 'azure') {
      return await azureService.streamCompletion(prompt, config.modelId);
    }
    throw new Error(`Unknown model type: ${config.type}`);
  } catch (error) {
    throw new Error(`${side} model error: ${error.message}`);
  }
}

/**
 * Process both streams concurrently and send SSE events
 */
async function processStreams(res, leftStream, rightStream) {
  const leftIterator = leftStream[Symbol.asyncIterator]();
  const rightIterator = rightStream[Symbol.asyncIterator]();

  let leftDone = false;
  let rightDone = false;
  let leftMetadata = null;
  let rightMetadata = null;

  while (!leftDone || !rightDone) {
    const promises = [];

    if (!leftDone) {
      promises.push(
        leftIterator.next().then((result) => ({
          side: 'left',
          result
        }))
      );
    }

    if (!rightDone) {
      promises.push(
        rightIterator.next().then((result) => ({
          side: 'right',
          result
        }))
      );
    }

    const results = await Promise.all(promises);

    for (const { side, result } of results) {
      if (result.done) {
        if (side === 'left') leftDone = true;
        if (side === 'right') rightDone = true;
      } else {
        const value = result.value;

        if (value.metadata) {
          if (side === 'left') leftMetadata = value.metadata;
          if (side === 'right') rightMetadata = value.metadata;
        } else if (value.error) {
          res.write(
            `data: ${JSON.stringify({
              type: 'error',
              side,
              message: value.error
            })}\n\n`
          );
        } else if (value.content) {
          res.write(
            `data: ${JSON.stringify({
              type: 'chunk',
              side,
              content: value.content
            })}\n\n`
          );
        }
      }
    }
  }

  // Send final metrics
  res.write(
    `data: ${JSON.stringify({
      type: 'metrics',
      left: leftMetadata,
      right: rightMetadata
    })}\n\n`
  );
}

/**
 * GET /api/models
 * Get available models
 */
router.get('/models', (req, res) => {
  const models = Object.entries(AVAILABLE_MODELS).map(([key, value]) => ({
    id: key,
    name: value.name,
    type: value.type
  }));

  res.json({ models });
});

/**
 * GET /api/health
 * Health check
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

module.exports = router;
