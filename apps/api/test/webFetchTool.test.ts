import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { WebFetchTool } from '../src/services/webFetchTool';
import type { OpenRouterToolCall } from '../src/services/openrouter';

const makeToolCall = (url: string): OpenRouterToolCall => ({
  id: 'call_fetch',
  type: 'function',
  function: {
    name: 'web_fetch',
    arguments: JSON.stringify({ url }),
  },
});

describe('WebFetchTool', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('rejects invalid URLs', async () => {
    const tool = new WebFetchTool({ resolveHostnames: false });
    const result = await tool.runToolCall(makeToolCall('not-a-url'));
    const parsed = JSON.parse(result) as { error?: string };
    expect(parsed.error).toBeDefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('blocks localhost', async () => {
    const tool = new WebFetchTool({ resolveHostnames: false });
    const result = await tool.runToolCall(makeToolCall('http://localhost/test'));
    const parsed = JSON.parse(result) as { error?: string };
    expect(parsed.error).toContain('Blocked');
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns stripped html text', async () => {
    const tool = new WebFetchTool({ resolveHostnames: false });
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      url: 'https://example.com',
      headers: {
        get: (name: string) => (name === 'content-type' ? 'text/html' : null),
      },
      body: {
        getReader() {
          let done = false;
          return {
            async read() {
              if (done) return { done: true, value: undefined };
              done = true;
              return {
                done: false,
                value: new TextEncoder().encode('<html><body>Hello <b>world</b></body></html>'),
              };
            },
          };
        },
      },
    });

    const result = await tool.runToolCall(makeToolCall('https://example.com'));
    const parsed = JSON.parse(result) as { text: string };
    expect(parsed.text).toBe('Hello world');
  });
});
