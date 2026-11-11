import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import {
  listSessions,
  createSession,
  getSession,
  updateSession,
  getMessages,
  appendMessage,
} from './storage.js';
import { retrieveMemory } from './memory.js';
import { runChat } from './agent.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.use('/vendor/marked', express.static(path.join(process.cwd(), 'node_modules/marked')));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/sessions', async (_req, res) => {
  res.json({ sessions: await listSessions() });
});

app.post('/api/sessions', async (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.slice(0, 80) : 'New chat';
  const session = await createSession(title);
  res.json({ session });
});

app.get('/api/sessions/:id/messages', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  res.json({ session, messages: await getMessages(session.id) });
});

app.post('/api/chat', async (req, res) => {
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  if (!message) return res.status(400).json({ error: 'message is required' });

  let sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
  let session = sessionId ? await getSession(sessionId) : null;
  if (!session) {
    const title = message.slice(0, 60) || 'New chat';
    session = await createSession(title);
    sessionId = session.id;
  }

  await appendMessage({ sessionId: session.id, role: 'user', content: message });

  const history = await getMessages(session.id);
  const modelMessages = history
    .slice(-24)
    .map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }))
    .filter((m) => m.role !== 'system');

  const memory = await retrieveMemory(message, new Date(), session.id);
  const now = new Date();
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const systemContext = [
    `Current date/time: ${now.toISOString()} (${timeZone}).`,
    memory.text,
  ]
    .filter(Boolean)
    .join('\n\n');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  let assistantText = '';
  try {
    const result = await runChat({
      messages: modelMessages,
      systemContext,
      onChunk: (chunk) => {
        if (chunk.type === 'text') assistantText += chunk.delta;
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      },
    });
    const finalText = result.text || assistantText;
    await appendMessage({
      sessionId: session.id,
      role: 'assistant',
      content: finalText,
    });
    await updateSession(session.id, { updatedAt: new Date().toISOString() });

    res.write(`data: ${JSON.stringify({ type: 'done', sessionId: session.id })}\n\n`);
    res.end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.write(`data: ${JSON.stringify({ type: 'error', error: msg })}\n\n`);
    res.end();
  }
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.listen(config.port, () => {
  console.log(`Chat agent running at http://localhost:${config.port}`);
});
