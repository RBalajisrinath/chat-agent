# Chat Agent with Web Search — Design

## How it works
- **Frontend:** a small single-page chat UI (Express serves static files). Messages stream over SSE; markdown is rendered client-side.
- **Backend:** Node/TypeScript Express server. Each turn:
  1. Persist the user message in a JSON store (`data/db.json`).
  2. Retrieve relevant prior conversation (see Memory).
  3. Call the model with a system prompt, conversation history, retrieved memory, and one tool: `web_search`.
  4. Stream text/tool events to the UI, then persist the assistant reply.
- **Model:** provider-agnostic via the Vercel AI SDK. Auto-detects OpenAI, Anthropic, Google, or an OpenAI-compatible endpoint (Ollama/LM Studio) from env vars. Defaults to OpenAI `gpt-4o` when `OPENAI_API_KEY` is present.
- **Web search:** one `web_search` tool exposed to the model. It accepts either one query or a batch of queries that run in parallel. Internally it tries Tavily → Brave → Serper → DuckDuckGo (no key required) in order, dedupes results, and enriches the top 3 pages by fetching and extracting readable text. Results are cached for 5 minutes.
- **Memory:** every message is stored with a timestamp. On each turn, `chrono-node` parses dates in the user's message (e.g. "3 November", "last Tuesday", "Monday"). Messages are scored by date proximity, keyword overlap, role, recency, and active-session membership; the top snippets are injected into the system prompt as timestamped prior conversation. The active session's recent turns are always included.

## Why this design
- **One real tool, rich internals:** the model only sees `web_search`, keeping the tool surface simple and reliable, while the backend handles provider fallback and page enrichment for accuracy.
- **Chat completions, not Responses API:** avoids provider-specific quirks (e.g. Ollama compatibility) and maximizes portability.
- **Persistent, timestamped memory:** the examples are fundamentally about "what did we discuss on date X"; a searchable, timestamped archive plus date parsing handles them better than a sliding context window.
- **Provider-agnostic model selection:** graders can run with whatever key they have; DuckDuckGo means search works with zero keys.
- **Streaming + caching:** fast first token, and repeated queries are instant.

## Considered and rejected
- **Vector database / embeddings:** better semantic recall, but adds infra and complexity; keyword + date scoring plus recent-session retention covers the test cases with no extra service. (Would add embeddings with more time.)
- **Letting the model search memory via a tool:** rejected because the prompt requires only web search as a tool; memory is injected as context instead.
- **Scraping search engines only:** fragile; added Tavily/Brave/Serper with a no-key fallback.
- **Next.js full stack:** more boilerplate and slower iteration; Express + static HTML is enough and easier to read.

## With another week
- Add hybrid semantic memory (embeddings + recency) and per-user profiles.
- Source-aware answer verification: re-search when the model's cited claim looks uncertain.
- Better tool loop observability and eval harness for the dataset.
- Authentication, multi-user isolation, and cloud storage.
- Richer UI: edit/regenerate, export, and tool-call detail panels.
EOF