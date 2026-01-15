import dns from 'dns/promises';
import net from 'net';
import pdfParse from 'pdf-parse';
import { OpenRouterToolCall, OpenRouterToolDefinition } from './openrouter';

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 200_000;
const DEFAULT_MAX_FULL_BYTES = 2_000_000;
const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_RETRY_MAX = 2;
const DEFAULT_RETRY_BASE_DELAY_MS = 300;
const DEFAULT_RETRY_MAX_DELAY_MS = 1500;

export const WEB_FETCH_TOOL_NAME = 'web_fetch';

export const webFetchToolDefinition: OpenRouterToolDefinition = {
  type: 'function',
  function: {
    name: WEB_FETCH_TOOL_NAME,
    description: 'Fetch a web page by URL and return readable text.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The http(s) URL to fetch.',
        },
        maxBytes: {
          type: 'number',
          description: 'Optional maximum response size in bytes.',
        },
        truncate: {
          type: 'boolean',
          description:
            'Set to false to attempt a full response (may still be capped for safety).',
        },
        render: {
          type: 'boolean',
          description: 'Force a JavaScript-rendered fetch when a render service is configured.',
        },
      },
      required: ['url'],
    },
  },
};

export type WebFetchResult = {
  url: string;
  status: number | null;
  contentType: string | null;
  title?: string | null;
  text: string;
  truncated: boolean;
  rendered?: boolean;
  redirects?: string[];
  error?: string;
};

type WebFetchRenderMode = 'off' | 'auto' | 'always';

type WebFetchRenderConfig = {
  url: string;
  mode?: WebFetchRenderMode;
  header?: string;
  token?: string;
};

type WebFetchToolOptions = {
  timeoutMs?: number;
  maxBytes?: number;
  maxFullBytes?: number;
  resolveHostnames?: boolean;
  allowedDomains?: string[];
  blockedDomains?: string[];
  maxRedirects?: number;
  render?: WebFetchRenderConfig;
  retry?: {
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  };
};

export class WebFetchTool {
  private timeoutMs: number;
  private maxBytes: number;
  private maxFullBytes: number;
  private resolveHostnames: boolean;
  private allowedDomains?: string[];
  private blockedDomains?: string[];
  private maxRedirects: number;
  private render?: WebFetchRenderConfig;
  private retryMax: number;
  private retryBaseDelayMs: number;
  private retryMaxDelayMs: number;

  constructor(options: WebFetchToolOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxFullBytes = options.maxFullBytes ?? DEFAULT_MAX_FULL_BYTES;
    this.resolveHostnames = options.resolveHostnames ?? true;
    this.allowedDomains = options.allowedDomains;
    this.blockedDomains = options.blockedDomains;
    this.maxRedirects = Math.max(
      0,
      Math.floor(options.maxRedirects ?? DEFAULT_MAX_REDIRECTS),
    );
    this.render = options.render;
    this.retryMax = Math.max(0, Math.floor(options.retry?.maxRetries ?? DEFAULT_RETRY_MAX));
    this.retryBaseDelayMs = Math.max(
      0,
      Math.floor(options.retry?.baseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS),
    );
    this.retryMaxDelayMs = Math.max(
      this.retryBaseDelayMs,
      Math.floor(options.retry?.maxDelayMs ?? DEFAULT_RETRY_MAX_DELAY_MS),
    );
  }

  async runToolCall(toolCall: OpenRouterToolCall): Promise<string> {
    const argumentsPayload = toolCall.function.arguments ?? '';
    let url = '';
    let maxBytes = this.maxBytes;
    let truncate = true;
    let render = false;
    try {
      const parsed = JSON.parse(argumentsPayload);
      url = typeof parsed?.url === 'string' ? parsed.url : '';
      if (typeof parsed?.truncate === 'boolean') {
        truncate = parsed.truncate;
      }
      if (typeof parsed?.render === 'boolean') {
        render = parsed.render;
      }
      if (typeof parsed?.maxBytes === 'number' && Number.isFinite(parsed.maxBytes)) {
        const cap = truncate ? 500_000 : this.maxFullBytes;
        maxBytes = Math.max(10_000, Math.min(cap, Math.round(parsed.maxBytes)));
      }
    } catch (error) {
      return JSON.stringify({
        url: '',
        status: null,
        contentType: null,
        text: '',
        truncated: false,
        error: 'Invalid tool arguments. Expected JSON with a url string.',
      } satisfies WebFetchResult);
    }

    if (!truncate && maxBytes === this.maxBytes) {
      maxBytes = this.maxFullBytes;
    }

    if (!url.trim()) {
      return JSON.stringify({
        url: '',
        status: null,
        contentType: null,
        text: '',
        truncated: false,
        error: 'URL is required.',
      } satisfies WebFetchResult);
    }

    const result = await this.fetchUrl(url, maxBytes, render);
    return JSON.stringify(result);
  }

  private async fetchUrl(
    rawUrl: string,
    maxBytes: number,
    renderRequested: boolean,
  ): Promise<WebFetchResult> {
    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch (error) {
      return {
        url: rawUrl,
        status: null,
        contentType: null,
        text: '',
        truncated: false,
        error: 'Invalid URL.',
      };
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return {
        url: rawUrl,
        status: null,
        contentType: null,
        text: '',
        truncated: false,
        error: 'Only http(s) URLs are supported.',
      };
    }

    if (parsed.username || parsed.password) {
      return {
        url: rawUrl,
        status: null,
        contentType: null,
        text: '',
        truncated: false,
        error: 'URLs with credentials are not supported.',
      };
    }

    const blocked = await this.isBlockedHost(parsed.hostname);
    if (blocked) {
      return {
        url: rawUrl,
        status: null,
        contentType: null,
        text: '',
        truncated: false,
        error: 'Blocked host.',
      };
    }

    const renderMode: WebFetchRenderMode = this.render?.mode ?? 'off';
    const shouldRenderFirst = renderMode === 'always' || renderRequested;

    if (shouldRenderFirst && this.render) {
      const rendered = await this.fetchWithRender(parsed.toString(), maxBytes);
      if (!rendered.error || renderMode === 'always' || renderRequested) {
        return rendered;
      }
    }

    const direct = await this.fetchAndProcess(parsed.toString(), maxBytes);
    if (!this.render || renderMode !== 'auto') {
      return direct;
    }
    if (direct.error) return direct;
    if (!direct.contentType || !direct.contentType.toLowerCase().includes('text/html')) {
      return direct;
    }
    if (direct.text.length >= 200) {
      return direct;
    }

    const rendered = await this.fetchWithRender(parsed.toString(), maxBytes);
    if (!rendered.error) {
      return rendered;
    }
    return direct;
  }

  private async readBody(
    response: Response,
    maxBytes: number,
  ): Promise<{ buffer: Buffer; text: string; truncated: boolean }> {
    if (!response.body) {
      return { buffer: Buffer.alloc(0), text: '', truncated: false };
    }

    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let received = 0;
    let truncated = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const chunk = Buffer.from(value);
      const remaining = maxBytes - received;
      if (chunk.length > remaining) {
        chunks.push(chunk.subarray(0, remaining));
        received = maxBytes;
        truncated = true;
        break;
      }
      chunks.push(chunk);
      received += chunk.length;
      if (received >= maxBytes) {
        truncated = true;
        break;
      }
    }

    const buffer = Buffer.concat(chunks);
    return { buffer, text: buffer.toString('utf-8'), truncated };
  }

  private buildFetchHeaders(): Record<string, string> {
    return {
      Accept: 'text/html, text/plain;q=0.9, application/json;q=0.8, */*;q=0.2',
      'User-Agent': 'pro-chat/1.0 (+https://local)',
    };
  }

  private buildRenderHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'text/html, text/plain;q=0.9, application/json;q=0.8, */*;q=0.2',
      'User-Agent': 'pro-chat/1.0 (+https://local)',
    };
    if (this.render?.header && this.render.token) {
      headers[this.render.header] = this.render.token;
    }
    return headers;
  }

  private async fetchWithRender(targetUrl: string, maxBytes: number): Promise<WebFetchResult> {
    if (!this.render) {
      return {
        url: targetUrl,
        status: null,
        contentType: null,
        text: '',
        truncated: false,
        rendered: false,
        error: 'No render service configured.',
      };
    }

    const renderUrl = buildRenderUrl(this.render.url, targetUrl);
    return this.fetchAndProcess(renderUrl, maxBytes, {
      resultUrl: targetUrl,
      rendered: true,
      headers: this.buildRenderHeaders(),
      skipDomainChecks: true,
    });
  }

  private async fetchAndProcess(
    requestUrl: string,
    maxBytes: number,
    options?: {
      resultUrl?: string;
      rendered?: boolean;
      headers?: Record<string, string>;
      skipDomainChecks?: boolean;
    },
  ): Promise<WebFetchResult> {
    try {
      const { response, redirects, finalUrl } = await this.fetchWithRetry(
        requestUrl,
        {
          method: 'GET',
          headers: options?.headers ?? this.buildFetchHeaders(),
        },
        options?.skipDomainChecks ?? false,
      );

      const contentType = response.headers.get('content-type');
      const urlForResult = options?.resultUrl ?? finalUrl ?? requestUrl;
      const isPdf = isPdfContent(contentType, response, urlForResult);
      if (!this.isSupportedContentType(contentType) && !isPdf) {
        return {
          url: urlForResult,
          status: response.status,
          contentType,
          text: '',
          truncated: false,
          rendered: options?.rendered,
          redirects,
          error: 'Unsupported content type.',
        };
      }

      const { buffer, text, truncated } = await this.readBody(response, maxBytes);
      if (isPdf) {
        try {
          const pdf = await pdfParse(buffer);
          const cleaned = normalizeText(pdf.text);
          return {
            url: urlForResult,
            status: response.status,
            contentType,
            title: typeof pdf.info?.Title === 'string' ? pdf.info.Title : null,
            text: cleaned,
            truncated,
            rendered: options?.rendered,
            redirects,
          };
        } catch (error) {
          return {
            url: urlForResult,
            status: response.status,
            contentType,
            text: '',
            truncated,
            rendered: options?.rendered,
            redirects,
            error: 'Failed to extract PDF text.',
          };
        }
      }

      let cleaned = text.trim();
      let title: string | null | undefined = null;
      if (contentType && contentType.toLowerCase().includes('text/html')) {
        title = extractHtmlTitle(text);
        cleaned = stripHtml(text);
      }

      return {
        url: urlForResult,
        status: response.status,
        contentType,
        title,
        text: cleaned,
        truncated,
        rendered: options?.rendered,
        redirects,
      };
    } catch (error) {
      return {
        url: options?.resultUrl ?? requestUrl,
        status: null,
        contentType: null,
        text: '',
        truncated: false,
        rendered: options?.rendered,
        error: error instanceof Error ? error.message : 'Fetch failed.',
      };
    }
  }

  private async fetchWithRetry(
    requestUrl: string,
    options: RequestInit,
    skipDomainChecks: boolean,
  ): Promise<{ response: Response; redirects: string[]; finalUrl: string }> {
    let attempt = 0;
    while (attempt <= this.retryMax) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const { response, redirects, finalUrl } = await this.fetchWithRedirects(
          requestUrl,
          {
            ...options,
            redirect: 'manual',
            signal: controller.signal,
          },
          skipDomainChecks,
        );
        if (
          isRetryableStatus(response.status) &&
          attempt < this.retryMax
        ) {
          const cancelPromise = response.body?.cancel();
          if (cancelPromise) {
            cancelPromise.catch(() => undefined);
          }
          const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
          const delay = retryAfter ?? computeBackoffDelay(attempt, this.retryBaseDelayMs, this.retryMaxDelayMs);
          await sleep(delay);
          attempt += 1;
          continue;
        }
        return { response, redirects, finalUrl };
      } catch (error) {
        if (
          attempt < this.retryMax &&
          isRetryableError(error)
        ) {
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
    throw new Error('Fetch failed after retries.');
  }

  private async fetchWithRedirects(
    requestUrl: string,
    options: RequestInit,
    skipDomainChecks: boolean,
  ): Promise<{ response: Response; redirects: string[]; finalUrl: string }> {
    let currentUrl = requestUrl;
    const redirects: string[] = [];
    const visited = new Set<string>();

    for (let i = 0; i <= this.maxRedirects; i += 1) {
      if (visited.has(currentUrl)) {
        throw new Error('Redirect loop detected.');
      }
      visited.add(currentUrl);

      const response = await fetch(currentUrl, options);
      if (isRedirectStatus(response.status)) {
        const location = response.headers.get('location');
        if (!location) {
          return { response, redirects, finalUrl: currentUrl };
        }
        const nextUrl = new URL(location, currentUrl).toString();
        const parsed = new URL(nextUrl);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
          throw new Error('Unsupported redirect protocol.');
        }
        if (!skipDomainChecks) {
          const blocked = await this.isBlockedHost(parsed.hostname);
          if (blocked) {
            throw new Error('Blocked host.');
          }
        }
        redirects.push(nextUrl);
        currentUrl = nextUrl;
        continue;
      }
      return { response, redirects, finalUrl: response.url || currentUrl };
    }

    throw new Error('Too many redirects.');
  }

  private isSupportedContentType(contentType: string | null): boolean {
    if (!contentType) return true;
    const type = contentType.toLowerCase();
    return (
      type.startsWith('text/') ||
      type.includes('application/pdf') ||
      type.includes('application/json') ||
      type.includes('application/xml') ||
      type.includes('application/xhtml') ||
      type.includes('text/html')
    );
  }

  private async isBlockedHost(hostname: string): Promise<boolean> {
    const lower = hostname.toLowerCase();
    if (this.allowedDomains && this.allowedDomains.length > 0) {
      const allowed = this.allowedDomains.some((domain) => matchesDomain(lower, domain));
      if (!allowed) return true;
    }
    if (this.blockedDomains && this.blockedDomains.length > 0) {
      const blocked = this.blockedDomains.some((domain) => matchesDomain(lower, domain));
      if (blocked) return true;
    }
    if (lower === 'localhost' || lower.endsWith('.local')) return true;
    if (net.isIP(lower)) {
      return isPrivateIp(lower);
    }
    if (!this.resolveHostnames) return false;
    try {
      const lookups = await dns.lookup(lower, { all: true });
      return lookups.some((entry) => isPrivateIp(entry.address));
    } catch (error) {
      return true;
    }
  }
}

function matchesDomain(hostname: string, domain: string): boolean {
  const clean = domain.toLowerCase();
  if (!clean) return false;
  return hostname === clean || hostname.endsWith(`.${clean}`);
}

function buildRenderUrl(template: string, targetUrl: string): string {
  if (template.includes('{url}')) {
    return template.replace(/\{url\}/g, encodeURIComponent(targetUrl));
  }
  try {
    const url = new URL(template);
    url.searchParams.set('url', targetUrl);
    return url.toString();
  } catch (error) {
    const separator = template.includes('?') ? '&' : '?';
    return `${template}${separator}url=${encodeURIComponent(targetUrl)}`;
  }
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400;
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, 30_000);
  }
  const date = new Date(header);
  const delta = date.getTime() - Date.now();
  if (!Number.isFinite(delta) || delta <= 0) return null;
  return Math.min(delta, 30_000);
}

function computeBackoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const jitter = Math.random() * 0.3 + 0.85;
  const delay = Math.min(maxMs, baseMs * 2 ** attempt);
  return Math.max(0, Math.floor(delay * jitter));
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return true;
  const message = error.message.toLowerCase();
  if (message.includes('blocked host')) return false;
  if (message.includes('invalid url')) return false;
  if (message.includes('unsupported redirect protocol')) return false;
  return true;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPdfContent(contentType: string | null, response: Response, url: string): boolean {
  const type = contentType?.toLowerCase() ?? '';
  if (type.includes('application/pdf')) return true;
  const disposition = response.headers.get('content-disposition')?.toLowerCase() ?? '';
  if (disposition.includes('.pdf')) return true;
  return url.toLowerCase().includes('.pdf');
}

function normalizeText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

function extractHtmlTitle(input: string): string | null {
  const match = input.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (!match) return null;
  const title = match[1].replace(/\s+/g, ' ').trim();
  return title || null;
}

function stripHtml(input: string): string {
  const withoutScripts = input.replace(/<script[\s\S]*?<\/script>/gi, ' ');
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const withoutTags = withoutStyles.replace(/<\/?[^>]+>/g, ' ');
  const decoded = withoutTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
  return decoded.replace(/\s+/g, ' ').trim();
}

function isPrivateIp(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map((part) => Number(part));
    if (a === 10) return true;
    if (a === 127) return true;
    if (a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe80')) return true;
  }
  return false;
}
