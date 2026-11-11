import * as chrono from 'chrono-node';
import { loadDatabase } from './storage.js';

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when', 'at', 'by', 'for', 'with', 'about',
  'into', 'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out',
  'on', 'off', 'over', 'under', 'again', 'further', 'once', 'here', 'there', 'where', 'why', 'how', 'all',
  'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just', 'don', 'should', 'now', 'i', 'me', 'my', 'we',
  'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them', 'what', 'which', 'who', 'whom', 'this', 'that',
  'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do',
  'does', 'did', 'of', 'as',
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86400000;
}

export type MemorySnippet = {
  createdAt: string;
  role: string;
  content: string;
  sessionId: string;
};

export async function retrieveMemory(
  userQuery: string,
  now = new Date(),
  currentSessionId?: string,
): Promise<{ text: string; snippets: MemorySnippet[] }> {
  const db = await loadDatabase();
  const parsed = chrono.parse(userQuery, now) as any[];
  const ranges = parsed.map((p) => {
    const start = p.start.date();
    const end = p.end ? p.end.date() : endOfDay(start);
    return { start, end };
  });

  const tokens = tokenize(userQuery);
  const scored = db.messages.map((m) => {
    let score = 0;
    const created = new Date(m.createdAt);

    for (const r of ranges) {
      if (created >= r.start && created <= r.end) score += 8;
      else if (daysBetween(created, r.start) <= 1) score += 3;
    }

    const contentTokens = new Set(tokenize(m.content));
    let overlap = 0;
    for (const t of tokens) if (contentTokens.has(t)) overlap++;
    score += Math.min(overlap, 5);

    if (m.role === 'user') score += 0.3;
    const ageDays = daysBetween(created, now);
    score += Math.max(0, 1 - ageDays / 45) * 0.8;

    if (currentSessionId && m.sessionId === currentSessionId) score += 0.2;

    return { m, score };
  });

  // Always retain the recent turns of the active session so follow-ups work
  // even when keyword overlap is low.
  const recentCurrent = currentSessionId
    ? db.messages
        .filter((m) => m.sessionId === currentSessionId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, 8)
    : [];
  const recentSet = new Set(recentCurrent.map((m) => m.id));

  const selected = [
    ...recentCurrent.map((m) => ({ m, score: 10 })),
    ...scored.filter((x) => !recentSet.has(x.m.id)),
  ]
    .filter((x) => x.score >= 0.8)
    .sort((a, b) => b.score - a.score || b.m.createdAt.localeCompare(a.m.createdAt))
    .slice(0, 16);

  // Deduplicate by message id and keep chronological order for readability.
  const unique = [...new Map(selected.map((x) => [x.m.id, x])).values()];
  const ordered = unique.sort((a, b) => a.m.createdAt.localeCompare(b.m.createdAt));

  const snippets: MemorySnippet[] = ordered.map((x) => ({
    createdAt: x.m.createdAt,
    role: x.m.role,
    content: x.m.content.slice(0, 600),
    sessionId: x.m.sessionId,
  }));

  if (snippets.length === 0) return { text: '', snippets };

  const lines = snippets.map((s) => `[${s.createdAt}] ${s.role}: ${s.content.replace(/\s+/g, ' ').trim()}`);
  const text = `Relevant prior conversation (timestamped; may be from earlier sessions):\n${lines.join('\n')}`;
  return { text, snippets };
}
