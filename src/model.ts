import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';

export function getModel() {
  if (process.env.OPENAI_API_KEY) {
    const openai = createOpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
    return openai.chat(process.env.OPENAI_MODEL || 'gpt-4o');
  }

  if (process.env.ANTHROPIC_API_KEY) {
    const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    return anthropic(process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest');
  }

  if (process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
    const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY });
    return google(process.env.GOOGLE_MODEL || 'gemini-2.0-flash');
  }

  // OpenAI-compatible fallback (Ollama, LM Studio, etc.)
  const baseURL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434/v1';
  const openai = createOpenAI({ baseURL, apiKey: process.env.OLLAMA_API_KEY || 'ollama' });
  return openai.chat(process.env.OLLAMA_MODEL || 'llama3.2:1b');
}
