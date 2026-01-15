import { SearchProvider, SearchResult } from './searchTool';

type BraveSearchProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  defaultCount?: number;
  maxResults?: number;
  minIntervalMs?: number;
  timeoutMs?: number;
  retryMax?: number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
};

export class BraveSearchProvider implements SearchProvider {
  private apiKey: string;
  private baseUrl: string;
  private defaultCount: number;
  private maxResults: number;
  private minIntervalMs: number;
  private timeoutMs: number;
  private retryMax: number;
  private retryBaseDelayMs: number;
  private retryMaxDelayMs: number;
  private queue: Promise<unknown> = Promise.resolve();
  private lastRequestAt = 0;

  constructor(options: BraveSearchProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl ?? 'https://api.search.brave.com/res/v1/web/search';
    this.defaultCount = options.defaultCount ?? 5;
    this.maxResults = options.maxResults ?? 10;
    this.minIntervalMs = options.minIntervalMs ?? 1000;
    this.timeoutMs = options.timeoutMs ?? 8000;
    this.retryMax = Math.max(0, Math.floor(options.retryMax ?? 2));
    this.retryBaseDelayMs = Math.max(0, Math.floor(options.retryBaseDelayMs ?? 300));
    this.retryMaxDelayMs = Math.max(
      this.retryBaseDelayMs,
      Math.floor(options.retryMaxDelayMs ?? 1500),
    );
  }

  async search(query: string, options?: { limit?: number }): Promise<SearchResult[]> {
    const limit = options?.limit ?? this.defaultCount;
    return this.enqueue(() => this.performSearch(query, limit));
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = async () => {
      const now = Date.now();
      const waitFor = Math.max(0, this.lastRequestAt + this.minIntervalMs - now);
      if (waitFor > 0) {
        await new Promise((resolve) => setTimeout(resolve, waitFor));
      }
      this.lastRequestAt = Date.now();
      return task();
    };

    const next = this.queue.then(run, run);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async performSearch(query: string, limit: number): Promise<SearchResult[]> {
    const count = Math.max(1, Math.min(this.maxResults, Math.round(limit)));
    const url = new URL(this.baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(count));

    let attempt = 0;
    while (attempt <= this.retryMax) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip',
            'X-Subscription-Token': this.apiKey,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          if (isRetryableStatus(response.status) && attempt < this.retryMax) {
            const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
            const delay =
              retryAfter ?? computeBackoffDelay(attempt, this.retryBaseDelayMs, this.retryMaxDelayMs);
            await sleep(delay);
            attempt += 1;
            continue;
          }
          const text = await response.text();
          throw new Error(`Brave Search error ${response.status}: ${text}`);
        }

        const data = (await response.json()) as {
          web?: {
            results?: Array<{
              title?: string;
              url?: string;
              description?: string;
              snippet?: string;
              text?: string;
            }>;
          };
        };

        const results = (data.web?.results ?? [])
          .filter((result) => result.title && result.url)
          .map((result) => ({
            title: result.title ?? '',
            url: result.url ?? '',
            snippet: result.description ?? result.snippet ?? result.text ?? undefined,
          }))
          .slice(0, count);

        return results;
      } catch (error) {
        if (attempt < this.retryMax && isRetryableError(error)) {
          const delay = computeBackoffDelay(attempt, this.retryBaseDelayMs, this.retryMaxDelayMs);
          await sleep(delay);
          attempt += 1;
          continue;
        }
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }

    return [];
  }
}

const isRetryableStatus = (status: number): boolean => status === 429 || status >= 500;

const parseRetryAfter = (header: string | null): number | null => {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30_000);
  }
  const date = new Date(header);
  const delta = date.getTime() - Date.now();
  if (!Number.isFinite(delta) || delta <= 0) return null;
  return Math.min(delta, 30_000);
};

const computeBackoffDelay = (attempt: number, baseMs: number, maxMs: number): number => {
  const jitter = Math.random() * 0.3 + 0.85;
  const delay = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.max(0, Math.floor(delay * jitter));
};

const isRetryableError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return true;
  if (error.name === 'AbortError') return true;
  return true;
};

const sleep = (ms: number): Promise<void> => {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
};
