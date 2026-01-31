# LLM Response Comparator

![LLM Response Comparator](main.png)

A professional, lightweight Node.js web application for comparing responses from different LLM models side-by-side in real-time.

## Features

- **Side-by-side comparison**: Compare two LLM models simultaneously
- **Real-time streaming**: Watch responses stream in as they're generated
- **Two GPT deployments**: Compare two Azure OpenAI models configured via `.env`
- **Metrics tracking**: Response time and token count for each model
- **Clean UI**: Professional, minimal SaaS-style interface
- **Copy to clipboard**: Easily copy responses
- **Responsive design**: Works on desktop and tablet

## Tech Stack

- **Backend**: Node.js + Express.js
- **Frontend**: Vanilla JavaScript + EJS templating
- **Styling**: TailwindCSS (CDN) + custom CSS
- **Streaming**: Server-Sent Events (SSE)
- **APIs**: Azure OpenAI (via Axios)

## Project Structure

```
llm-compare-app/
├── server.js              # Main Express server
├── package.json           # Dependencies
├── .env                   # Environment variables (create from .env.example)
├── routes/
│   └── api.js            # API endpoints (/api/compare, /api/models, /api/health)
├── services/
│   ├── openaiService.js  # OpenAI integration
│   └── azureService.js   # Azure OpenAI integration
├── views/
│   └── index.ejs         # Main HTML template
└── public/
    ├── css/
    │   └── styles.css    # Custom styling
    └── js/
        └── app.js        # Frontend JavaScript
```

## Installation

### Prerequisites

- Node.js 18+ (LTS recommended)
- npm or yarn
- OpenAI API key (and/or Azure OpenAI credentials)

### Setup

1. **Clone or create the project**:
   ```bash
   cd ResponseCompare
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Create `.env` file**:
   ```bash
   cp .env.example .env
   ```

4. **Configure `.env`** with your Azure OpenAI credentials (no code changes required):
   ```env
   PORT=3001
   NODE_ENV=development
   MODEL_1_NAME=Azure GPT-4.1 (Left)
   MODEL_1_ENDPOINT=https://your-resource.openai.azure.com
   MODEL_1_API_KEY=your_api_key_1
   MODEL_1_DEPLOYMENT_ID=gpt-4.1
   MODEL_1_API_VERSION=2025-01-01-preview
   MODEL_2_NAME=Azure GPT-4.1 (Right)
   MODEL_2_ENDPOINT=https://your-resource.openai.azure.com
   MODEL_2_API_KEY=your_api_key_2
   MODEL_2_DEPLOYMENT_ID=gpt-4.1
   MODEL_2_API_VERSION=2025-01-01-preview
   ```

## Running the Application

### Development Mode (with auto-reload):
```bash
npm run dev
```

### Production Mode:
```bash
npm start
```

The app will be available at: `http://localhost:3001`

## API Endpoints

### POST /api/compare
Compare responses from two models.

**Request**:
```json
{
  "prompt": "What is artificial intelligence?",
  "leftModel": "azure-gpt-4-model-1",
  "rightModel": "azure-gpt-4-model-2"
}
```

**Response**: Server-Sent Events stream with chunks and metrics

**Events**:
- `chunk`: Partial response text
  ```json
  { "type": "chunk", "side": "left", "content": "AI is..." }
  ```
- `metrics`: Final metrics for both models
  ```json
  {
    "type": "metrics",
    "left": { "duration": 1234, "tokenCount": 45 },
    "right": { "duration": 1567, "tokenCount": 48 }
  }
  ```
- `error`: Error message
- `complete`: Comparison finished

### GET /api/models
Get available models for comparison.

**Response**:
```json
{
  "models": [
    { "id": "azure-gpt-4-model-1", "name": "Azure GPT-4.1 (Left)", "type": "azure" },
    { "id": "azure-gpt-4-model-2", "name": "Azure GPT-4.1 (Right)", "type": "azure" }
  ]
}
```

### GET /api/health
Health check endpoint.

**Response**:
```json
{
  "status": "ok",
  "timestamp": "2024-01-31T10:30:00Z"
}
```

## Configuration

### Available Models (configured via .env)

This app compares **two Azure OpenAI deployments**. The dropdown labels come from `MODEL_1_NAME` and `MODEL_2_NAME` in your `.env`, and the backend uses these fixed model IDs:

- `azure-gpt-4-model-1`
- `azure-gpt-4-model-2`

To change which GPTs are compared, update your `.env` values (no code changes required).

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 3001) | No |
| `NODE_ENV` | Environment mode | No |
| `MODEL_1_NAME` | Left model display name | Yes |
| `MODEL_1_ENDPOINT` | Azure OpenAI endpoint for left model | Yes |
| `MODEL_1_API_KEY` | Azure OpenAI API key for left model | Yes |
| `MODEL_1_DEPLOYMENT_ID` | Azure OpenAI deployment name for left model | Yes |
| `MODEL_1_API_VERSION` | Azure OpenAI API version for left model | No (default: 2025-01-01-preview) |
| `MODEL_2_NAME` | Right model display name | Yes |
| `MODEL_2_ENDPOINT` | Azure OpenAI endpoint for right model | Yes |
| `MODEL_2_API_KEY` | Azure OpenAI API key for right model | Yes |
| `MODEL_2_DEPLOYMENT_ID` | Azure OpenAI deployment name for right model | Yes |
| `MODEL_2_API_VERSION` | Azure OpenAI API version for right model | No (default: 2025-01-01-preview) |

> Note: `OPENAI_API_KEY` is present in `.env.example` but is not used unless you wire OpenAI into `routes/api.js`.

## Usage

1. **Enter a prompt** in the textarea
2. **Select two different models** from the dropdowns
3. **Click "Compare"** to start the comparison
4. **Watch responses stream** in real-time
5. **View metrics**: Response time and token count appear below each response
6. **Copy results**: Use the "Copy" button to copy individual responses

### Keyboard Shortcut
Press `Ctrl+Enter` (or `Cmd+Enter` on Mac) to submit the prompt.

## Architecture Notes

### Modular Design

The application is designed for easy extension:

- **Service Layer**: Add new models by creating a service file in `/services` with a `streamCompletion()` method
- **Routes**: Register new models in `routes/api.js` `AVAILABLE_MODELS` object
- **Frontend**: Automatically discovers available models via `/api/models` endpoint

### Streaming Implementation

- Uses **Server-Sent Events (SSE)** for real-time updates
- Both model streams run **in parallel** for optimal performance
- Token counting uses approximation: `tokens ≈ characters / 4`
- Auto-scrolls response containers as content streams in

### Error Handling

- Validates prompt and model selections
- Catches API errors and displays user-friendly messages
- Timeout protection (60s per request)
- Graceful degradation for network issues

## Future Extensions

The architecture supports:

1. **Third model comparison**: Add a third column by updating the UI and adding a `rightModel` → `middleModel/rightModel` split
2. **Prompt history**: Store prompts in localStorage or SQLite
3. **Response storage**: Save comparisons to database
4. **Diff highlighting**: Highlight differences between responses
5. **Custom models**: Support for custom OpenAI deployments
6. **Batch processing**: Compare multiple prompts at once
7. **Export features**: Download comparisons as PDF/JSON

## Performance Considerations

- **Streaming**: Responses appear immediately (better UX than waiting for full response)
- **Parallel requests**: Both models queried simultaneously (faster overall time)
- **Lightweight frontend**: No heavy frameworks, minimal JavaScript
- **Server-rendered**: Base HTML rendered server-side for fast initial load

## Security

- ✅ API keys stored in environment variables (never exposed to frontend)
- ✅ Input validation on all endpoints
- ✅ Error messages don't leak sensitive information
- ✅ CORS configured for origin validation
- ✅ Rate limiting recommended for production (add express-rate-limit)

## Troubleshooting

### "Azure OpenAI configuration incomplete"
- Ensure all `MODEL_1_*` and `MODEL_2_*` variables are set in `.env`
- Confirm each `MODEL_*_ENDPOINT` is your Azure OpenAI endpoint (no trailing slash)
- Check `MODEL_*_DEPLOYMENT_ID` matches your Azure deployment name

### "Invalid model selection"
- Ensure you are selecting the two provided model IDs (`azure-gpt-4-model-1` and `azure-gpt-4-model-2`)
- Verify `MODEL_1_NAME` and `MODEL_2_NAME` are set (dropdown labels are derived from these)

### Responses not streaming
- Check browser console for errors
- Verify SSE connection is active
- Ensure backend is returning valid SSE format

### Azure models not working
- Verify `MODEL_1_*` and `MODEL_2_*` variables are set
- Ensure each `MODEL_*_ENDPOINT` is a full Azure OpenAI endpoint (e.g., `https://<resource>.openai.azure.com`)
- Confirm deployment names match your Azure configuration

## Development

### Adding a New Model

To compare different GPT deployments, **edit your `.env`** (no code changes required):

- Update `MODEL_1_*` and `MODEL_2_*` with the endpoints, deployment IDs, and names you want to compare.

If you want more than two models, you’ll need to extend:

- `AVAILABLE_MODELS` in [routes/api.js](routes/api.js)
- `azureService` config in [services/azureService.js](services/azureService.js)

### Monitoring

View server logs:
```bash
npm run dev
```

Check for errors in browser DevTools console and network tab.

## License

MIT

## Support

For issues or questions, check:
- Server logs for backend errors
- Browser console for frontend errors
- Verify `.env` configuration
- Test API connection with `/api/health` endpoint
