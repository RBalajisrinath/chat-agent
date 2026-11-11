import { streamText, tool, stepCountIs } from 'ai';
import { z } from 'zod';
import { webSearch } from './search.js';
import { getModel } from './model.js';

export type ChatChunk =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; toolName: string; input: unknown }
  | { type: 'tool_result'; toolName: string; result: unknown }
  | { type: 'error'; error: string };

const SYSTEM_PROMPT = `You are a helpful, accurate, and conversational chat assistant with web search.

You have exactly one tool: web_search. Use it whenever the user asks about current facts, prices, releases, news, comparisons, or whether something has changed. Prefer searching over guessing. Batch related queries into the queries array so they run in parallel.

Rules:
- Answer directly and concisely, then add detail if useful.
- When using search results, cite sources as markdown links.
- State dates explicitly. If information may be outdated, say so.
- If the user refers to an earlier conversation or asks what they said/asked, answer from the provided prior-conversation memory. Do not web search for memory questions unless the user asks to verify an external fact.
- Never fabricate URLs, prices, or release notes.
- If search fails or is inconclusive, say what you could not verify.

Current date/time is provided in the context below.`;

export async function runChat(options: {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  systemContext: string;
  onChunk: (chunk: ChatChunk) => void;
}): Promise<{ text: string }> {
  const tools = {
    web_search: tool({
      description:
        'Search the live web for current information. Returns ranked results with titles, URLs, snippets, and sometimes page text. Use specific queries; include product names, dates, or "pricing" when relevant.',
      inputSchema: z.object({
        query: z.string().optional().describe('A single search query'),
        queries: z
          .array(z.string())
          .optional()
          .describe('Multiple related queries to run in parallel for one question'),
        numResults: z
          .number()
          .int()
          .min(1)
          .max(10)
          .optional()
          .describe('Number of results to return per query (default 6)'),
      }),
      execute: async ({ query, queries, numResults }) => {
        const list = queries && queries.length ? queries : query ? [query] : [];
        const perQuery = numResults ?? 6;
        const settled = await Promise.allSettled(list.map((q) => webSearch(q, perQuery)));
        const combined = settled.map((s, i) => {
          if (s.status === 'rejected') {
            return { query: list[i], provider: 'error', results: [], error: String(s.reason) };
          }
          return {
            query: list[i],
            provider: s.value.provider,
            results: s.value.results.map((r) => ({
              title: r.title,
              url: r.url,
              snippet: r.snippet,
              publishedDate: r.publishedDate,
              content: r.content,
            })),
          };
        });
        return { searches: combined };
      },
    }),
  };

  const result = streamText({
    model: getModel(),
    system: `${SYSTEM_PROMPT}\n\n${options.systemContext}`.trim(),
    messages: options.messages as any,
    tools,
    stopWhen: stepCountIs(8),
    temperature: 0.2,
  });

  let text = '';
  for await (const part of result.fullStream) {
    if (part.type === 'text-delta') {
      text += part.text;
      options.onChunk({ type: 'text', delta: part.text });
    } else if (part.type === 'tool-call') {
      options.onChunk({ type: 'tool_call', toolName: part.toolName, input: part.input });
    } else if (part.type === 'tool-result') {
      options.onChunk({ type: 'tool_result', toolName: part.toolName, result: part.output });
    } else if (part.type === 'tool-error') {
      options.onChunk({ type: 'tool_result', toolName: part.toolName, result: { error: String((part as any).error) } });
    } else if (part.type === 'error') {
      options.onChunk({ type: 'error', error: String((part as any).errorText || (part as any).error) });
    }
  }

  const finalText = await result.text;
  return { text: finalText || text };
}
