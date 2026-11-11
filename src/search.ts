import * as cheerio from 'cheerio';

export type SearchResult = {
  title: string;
  url: string;
  snippet: string;
  publishedDate?: string;
  content?: string;
  source: string;
};

type CacheEntry = { expires: number; value: { provider: string; results: SearchResult[] } };
const cache = new Map<string, CacheEntry>();
const TTL_MS = 5 * 60 * 1000;

async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = 8000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeUrl(raw: string): string {
  try {
    if (raw.startsWith('//')) raw = 'https:' + raw;
    const u = new URL(raw);
    const uddg = u.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return u.toString();
  } catch {
    return raw;
  }
}

async function enrich(results: SearchResult[], limit = 3): Promise<void> {
  const targets = results.slice(0, limit);
  await Promise.allSettled(
    targets.map(async (r) => {
      try {
        const res = await fetchWithTimeout(r.url, { headers: { 'User-Agent': 'Mozilla/5.0 chat-agent' } }, 5000);
        if (!res.ok) return;
        const html = await res.text();
        const $ = cheerio.load(html);
        $('script, style, noscript, nav, header, footer, aside, form').remove();
        const text = ($('main, article, [role="main"]').first().text() || $('body').text())
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 1800);
        if (text.length > 120) r.content = text;
      } catch {
        // ignore enrichment failures
      }
    }),
  );
}

function dedup(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const r of results) {
    const key = r.url.split('?')[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

async function tavily(query: string, num: number): Promise<SearchResult[]> {
  const key = process.env.TAVILY_API_KEY!;
  const res = await fetchWithTimeout('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: num,
      search_depth: 'basic',
      include_answer: false,
    }),
  });
  if (!res.ok) throw new Error(`Tavily ${res.status}`);
  const data: any = await res.json();
  return (data.results || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || '',
    publishedDate: r.published_date,
    source: 'tavily',
  }));
}

async function brave(query: string, num: number): Promise<SearchResult[]> {
  const key = process.env.BRAVE_API_KEY!;
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${num}`;
  const res = await fetchWithTimeout(url, {
    headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Brave ${res.status}`);
  const data: any = await res.json();
  return (data.web?.results || []).map((r: any) => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.description || '',
    publishedDate: r.page_age,
    source: 'brave',
  }));
}

async function serper(query: string, num: number): Promise<SearchResult[]> {
  const key = process.env.SERPER_API_KEY!;
  const res = await fetchWithTimeout('https://google.serper.dev/search', {
    method: 'POST',
    headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: query, num }),
  });
  if (!res.ok) throw new Error(`Serper ${res.status}`);
  const data: any = await res.json();
  return (data.organic || []).map((r: any) => ({
    title: r.title || '',
    url: r.link || '',
    snippet: r.snippet || '',
    publishedDate: r.date,
    source: 'serper',
  }));
}

async function duckduckgo(query: string, num: number): Promise<SearchResult[]> {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchWithTimeout(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!res.ok) throw new Error(`DuckDuckGo ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const results: SearchResult[] = [];
  $('.result').each((_, el) => {
    if (results.length >= num) return false;
    const a = $(el).find('.result__a').first();
    const snippet = $(el).find('.result__snippet').text().trim();
    const href = a.attr('href');
    const title = a.text().trim();
    if (!title || !href) return;
    results.push({
      title,
      url: normalizeUrl(href),
      snippet,
      source: 'duckduckgo',
    });
  });
  return results;
}

function providerOrder(): string[] {
  const providers: string[] = [];
  if (process.env.TAVILY_API_KEY) providers.push('tavily');
  if (process.env.BRAVE_API_KEY) providers.push('brave');
  if (process.env.SERPER_API_KEY) providers.push('serper');
  providers.push('duckduckgo');
  return providers;
}

export async function webSearch(
  query: string,
  numResults = 8,
): Promise<{ provider: string; results: SearchResult[] }> {
  const cacheKey = `${query}::${numResults}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value;

  const num = Math.max(1, Math.min(10, numResults));
  let lastError: unknown;
  for (const provider of providerOrder()) {
    try {
      let results: SearchResult[] = [];
      if (provider === 'tavily') results = await tavily(query, num);
      else if (provider === 'brave') results = await brave(query, num);
      else if (provider === 'serper') results = await serper(query, num);
      else results = await duckduckgo(query, num);

      results = dedup(results).slice(0, num);
      if (results.length === 0) throw new Error('No results');
      await enrich(results, 3);
      const value = { provider, results };
      cache.set(cacheKey, { expires: Date.now() + TTL_MS, value });
      return value;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Search failed');
}
