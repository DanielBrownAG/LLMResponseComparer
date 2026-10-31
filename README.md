# LLM Response Comparer

![LLM Response Comparer](main.png)

Compare two OpenAI or Azure OpenAI models side by side, with independent live streaming, output token counts, and response times. OpenAI models use the Responses API; Azure deployments use Chat Completions.

## Setup

Requires Node.js 22+ and npm.

1. Run `npm install`.
2. Copy `.env.example` to `.env` (`Copy-Item .env.example .env` in PowerShell).
3. Configure either provider below, or both.
4. Run `npm start` and open [localhost:3001](http://localhost:3001).

Use `npm run dev` for automatic server restarts and `npm test` for mocked-provider regression tests. Tests do not make paid API calls.

### OpenAI and GPT-6

Set `OPENAI_API_KEY` in `.env`. The default model list is:

```env
OPENAI_API_KEY=your-key
OPENAI_MODELS=gpt-6-astra,gpt-6-sol,gpt-6-luna
```

Override `OPENAI_MODELS` with a comma-separated list of Responses-compatible model IDs available to your account, for example `gpt-6-astra,gpt-4.1`. The app does not verify account access when populating the picker; provider errors appear beside the affected model.

Requests enable streaming, disable response storage, and allow 16,384 output tokens (including reasoning tokens). Sampling parameters are omitted for reasoning-model compatibility. See the official [GPT-6 guide](https://developers.openai.com/api/docs/guides/latest-model) and [streaming guide](https://developers.openai.com/api/docs/guides/streaming-responses).

### Azure OpenAI

Each deployment is optional. Fill all three required values for a slot to appear in the picker:

| Variable | Meaning |
| --- | --- |
| `MODEL_1_ENDPOINT` | Resource endpoint, e.g. `https://resource.openai.azure.com` |
| `MODEL_1_API_KEY` | Resource API key |
| `MODEL_1_DEPLOYMENT_ID` | Actual Azure deployment name |
| `MODEL_1_NAME` | Optional display name; defaults to deployment name |
| `MODEL_1_MODEL` | Underlying model ID, especially when the deployment has a custom name |
| `MODEL_1_API_VERSION` | Deployment-supported API version; defaults to `2025-01-01-preview` |

Use the same variables with `MODEL_2_` for the second slot. Existing picker IDs `azure-gpt-4-model-1` and `azure-gpt-4-model-2` remain valid for any model configured in those slots.

Set `MODEL_n_MODEL` to the actual model family for custom deployment names. GPT-5, GPT-6, and o-series deployments use `max_completion_tokens` and omit temperature; older deployments retain their existing sampling settings. Azure model availability and supported API versions depend on your deployment.

Unused provider credentials can stay empty. The app starts without credentials and shows configuration guidance if fewer than two choices are available. Restart after changing `.env`.

## Usage

Enter a prompt, select two different models, and click **Compare**, or press Ctrl+Enter (Cmd+Enter on Mac). Both panels update independently, including while the other provider is connecting. **Clear** cancels both upstream requests. Copy buttons copy each panel's text.

Each side displays metrics as soon as it finishes. Output tokens come from provider usage; Azure falls back to a character estimate marked `~` if usage is absent. OpenAI reasoning tokens are included in its output token count. Errors preserve partial output and do not stop the other model. Truncated responses and interrupted streams are reported as errors.

## API

- `GET /api/models`: configured model IDs, names, and provider types; credentials are never returned.
- `GET /api/health`: status and timestamp.
- `POST /api/compare`: JSON body containing `prompt`, `leftModel`, and `rightModel`. Invalid selections return HTTP 400 before streaming starts.

Example request:

```json
{
  "prompt": "Explain how a rainbow forms.",
  "leftModel": "openai-gpt-6-astra",
  "rightModel": "openai-gpt-6-sol"
}
```

The response is an SSE stream. Each event is JSON in a `data:` line:

- `chunk`: `{ "type": "chunk", "side": "left", "content": "..." }`
- `metrics`: `{ "type": "metrics", "left": { "duration": 1234, "tokenCount": 45, "completed": true } }` (each side independently)
- `error`: `{ "type": "error", "side": "right", "message": "..." }`
- `complete`: `{ "type": "complete", "success": true }` (false if either side failed)

Comment heartbeats keep idle SSE connections active. Proxy buffering is disabled through `X-Accel-Buffering: no`; configure your reverse proxy to honor streaming. Provider requests have a 120-second timeout and are aborted when the browser disconnects.

## Development

- `server.js`: Express application and page rendering.
- `routes/api.js`: configured model registry, validation, and independent stream consumers.
- `services/openaiService.js`: OpenAI Responses streaming.
- `services/azureService.js`: Azure Chat Completions streaming and UTF-8-safe parsing.
- `public/js/app.js`: frontend streaming, cancellation, and metrics.
- `test/`: provider, HTTP integration, and frontend regression tests.

API keys stay in the ignored `.env` file. This app has no authentication or rate limiting; configure those before exposing it publicly. Tailwind CSS loads from its CDN. `PORT` defaults to 3001.

## License

MIT
