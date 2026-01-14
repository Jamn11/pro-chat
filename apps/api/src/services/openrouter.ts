import { createParser, ParsedEvent, ReconnectInterval } from 'eventsource-parser';

export type OpenRouterMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
};

export type OpenRouterUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type OpenRouterStreamResult = {
  content: string;
  usage?: OpenRouterUsage;
};

export type OpenRouterClientOptions = {
  apiKey: string;
  appUrl?: string;
  appName?: string;
};

export type StreamChatInput = {
  model: string;
  messages: OpenRouterMessage[];
  thinkingLevel?: 'low' | 'medium' | 'high' | 'xhigh' | null;
  signal?: AbortSignal;
};

export class OpenRouterClient {
  private apiKey: string;
  private appUrl?: string;
  private appName?: string;

  constructor(options: OpenRouterClientOptions) {
    this.apiKey = options.apiKey;
    this.appUrl = options.appUrl;
    this.appName = options.appName;
  }

  async streamChat(input: StreamChatInput, onDelta: (chunk: string) => void): Promise<OpenRouterStreamResult> {
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
      stream: true,
      streamOptions: { includeUsage: true },
    };

    if (input.thinkingLevel) {
      const effort = input.thinkingLevel === 'xhigh' ? 'high' : input.thinkingLevel;
      body.reasoning = { effort };
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (this.appUrl) headers['HTTP-Referer'] = this.appUrl;
    if (this.appName) headers['X-Title'] = this.appName;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: input.signal,
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${errorText}`);
    }

    const decoder = new TextDecoder();
    let content = '';
    let usage: OpenRouterUsage | undefined;

    let streamError: Error | null = null;
    const parser = createParser((event: ParsedEvent | ReconnectInterval) => {
      if (event.type !== 'event') return;
      const data = event.data;
      if (data === '[DONE]') {
        return;
      }
      try {
        const parsed = JSON.parse(data);
        if (parsed.error) {
          throw new Error(parsed.error.message || 'OpenRouter error');
        }
        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          content += delta;
          onDelta(delta);
        }
        if (parsed.usage) {
          usage = parsed.usage;
        }
      } catch (error) {
        streamError = error instanceof Error ? error : new Error('Failed to parse OpenRouter stream');
      }
    });

    const reader = response.body.getReader();
    let done = false;
    while (!done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      parser.feed(chunk);
      if (streamError) {
        throw streamError;
      }
    }

    return { content, usage };
  }
}
