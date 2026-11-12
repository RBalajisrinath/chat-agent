# Chat Agent with Web Search

A chat agent with persistent, timestamped memory and a single web-search tool.

## Run

```bash
npm install
cp .env.example .env
# fill in at least one model provider key (or run Ollama locally)
npm run dev
```

Open `http://localhost:3000`.

## Environment variables (`.env.example`)

Model provider (first available key is used):
- `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL` (default `gpt-4o`)
- `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
- `GOOGLE_GENERATIVE_AI_API_KEY`, `GOOGLE_MODEL`
- `OLLAMA_BASE_URL` (default `http://localhost:11434/v1`), `OLLAMA_MODEL`, `OLLAMA_API_KEY`

Web search (first available is used; DuckDuckGo needs no key):
- `TAVILY_API_KEY`
- `BRAVE_API_KEY`
- `SERPER_API_KEY`

Server:
- `PORT` (default `3000`)
- `DATA_DIR` (default `./data`)

## Notes
- No API key is strictly required: if no model key is set, the app falls back to a local Ollama endpoint, and search falls back to DuckDuckGo.
- Conversation history is stored in `data/db.json`.
- `npm run typecheck` runs the TypeScript compiler.

## Architecture
See `DESIGN.md`.
EOF