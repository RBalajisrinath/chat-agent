import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';

export type Session = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
};

export type Message = {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  meta?: Record<string, unknown>;
};

type Db = { sessions: Session[]; messages: Message[] };

const dbPath = path.join(config.dataDir, 'db.json');

async function ensureDir(): Promise<void> {
  await fs.mkdir(config.dataDir, { recursive: true });
}

async function loadDb(): Promise<Db> {
  try {
    const raw = await fs.readFile(dbPath, 'utf8');
    const parsed = JSON.parse(raw) as Db;
    return { sessions: parsed.sessions || [], messages: parsed.messages || [] };
  } catch (err: any) {
    if (err?.code === 'ENOENT') return { sessions: [], messages: [] };
    throw err;
  }
}

async function saveDb(db: Db): Promise<void> {
  await ensureDir();
  const tmp = dbPath + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
  await fs.rename(tmp, dbPath);
}

export async function listSessions(): Promise<Session[]> {
  const db = await loadDb();
  return [...db.sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createSession(title = 'New chat'): Promise<Session> {
  const db = await loadDb();
  const now = new Date().toISOString();
  const session: Session = { id: randomUUID(), title, createdAt: now, updatedAt: now };
  db.sessions.push(session);
  await saveDb(db);
  return session;
}

export async function getSession(id: string): Promise<Session | null> {
  const db = await loadDb();
  return db.sessions.find((s) => s.id === id) || null;
}

export async function updateSession(id: string, patch: Partial<Session>): Promise<void> {
  const db = await loadDb();
  const s = db.sessions.find((x) => x.id === id);
  if (!s) return;
  Object.assign(s, patch);
  await saveDb(db);
}

export async function getMessages(sessionId: string): Promise<Message[]> {
  const db = await loadDb();
  return db.messages
    .filter((m) => m.sessionId === sessionId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function appendMessage(input: Omit<Message, 'id' | 'createdAt'> & { createdAt?: string }): Promise<Message> {
  const db = await loadDb();
  const msg: Message = {
    id: randomUUID(),
    sessionId: input.sessionId,
    role: input.role,
    content: input.content,
    createdAt: input.createdAt || new Date().toISOString(),
    meta: input.meta,
  };
  db.messages.push(msg);
  await saveDb(db);
  return msg;
}

export async function loadDatabase(): Promise<Db> {
  return loadDb();
}

export async function searchMessages(query: string, limit = 20): Promise<Message[]> {
  const db = await loadDb();
  const q = query.toLowerCase();
  return db.messages
    .filter((m) => m.content.toLowerCase().includes(q))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}
