import { createParser, ParsedEvent, ReconnectInterval } from 'eventsource-parser';

export type OpenRouterToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type OpenRouterToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
};

export type OpenRouterToolChoice =
  | 'auto'
  | 'none'
  | {
      type: 'function';
      function: { name: string };
    };

type OpenRouterContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;

export type OpenRouterMessage =
  | {
      role: 'system' | 'user';
      content: OpenRouterContent;
    }
  | {
      role: 'assistant';
      content: OpenRouterContent | null;
      tool_calls?: OpenRouterToolCall[];
    }
  | {
      role: 'tool';
      content: string;
      tool_call_id: string;
    };

export type OpenRouterUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type OpenRouterStreamResult = {
  content: string;
  usage?: OpenRouterUsage;
  toolCalls?: OpenRouterToolCall[];
};

export type OpenRouterReasoning = {
  effort?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  max_tokens?: number;
  enabled?: boolean;
  exclude?: boolean;
};

export type OpenRouterClientOptions = {
  apiKey: string;
  appUrl?: string;
  appName?: string;
};

export type StreamChatInput = {
  model: string;
  messages: OpenRouterMessage[];
  reasoning?: OpenRouterReasoning | null;
  maxTokens?: number;
  tools?: OpenRouterToolDefinition[];
  toolChoice?: OpenRouterToolChoice;
  signal?: AbortSignal;
};

export type ChatInput = {
  model: string;
  messages: OpenRouterMessage[];
  maxTokens?: number;
  signal?: AbortSignal;
};

export type ChatResult = {
  content: string;
  usage?: OpenRouterUsage;
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

  async chat(input: ChatInput): Promise<ChatResult> {
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
      stream: false,
    };

    if (input.maxTokens) {
      body.max_tokens = input.maxTokens;
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

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter error ${response.status}: ${errorText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    const usage: OpenRouterUsage | undefined = data.usage;

    return { content, usage };
  }

  async streamChat(
    input: StreamChatInput,
    callbacks: {
      onDelta?: (chunk: string) => void;
      onReasoning?: (delta: string) => void;
    } = {},
  ): Promise<OpenRouterStreamResult> {
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
      stream: true,
      streamOptions: { includeUsage: true },
    };

    if (input.reasoning) {
      body.reasoning = input.reasoning;
    }
    if (input.maxTokens) {
      body.max_tokens = input.maxTokens;
    }
    if (input.tools && input.tools.length > 0) {
      body.tools = input.tools;
    }
    if (input.toolChoice) {
      body.tool_choice = input.toolChoice;
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
    const toolCalls: OpenRouterToolCall[] = [];
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
        const choice = parsed.choices?.[0];
        const delta = choice?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          content += delta;
          callbacks.onDelta?.(delta);
        }
        // Check reasoning field first (primary), then reasoning_details as fallback
        // Don't use both to avoid duplication
        const reasoningDelta = choice?.delta?.reasoning;
        if (typeof reasoningDelta === 'string' && reasoningDelta.length > 0) {
          callbacks.onReasoning?.(reasoningDelta);
        } else {
          // Only check reasoning_details if reasoning was not present
          const reasoningDetails = choice?.delta?.reasoning_details;
          if (Array.isArray(reasoningDetails)) {
            for (const detail of reasoningDetails) {
              const text = extractReasoningText(detail);
              if (text) {
                callbacks.onReasoning?.(text);
              }
            }
          }
        }
        const toolDeltas = choice?.delta?.tool_calls;
        if (Array.isArray(toolDeltas)) {
          for (const toolDelta of toolDeltas) {
            const index =
              typeof toolDelta.index === 'number' ? toolDelta.index : toolCalls.length;
            if (!toolCalls[index]) {
              toolCalls[index] = {
                id: toolDelta.id ?? `tool_${index}`,
                type: toolDelta.type ?? 'function',
                function: {
                  name: toolDelta.function?.name ?? '',
                  arguments: toolDelta.function?.arguments ?? '',
                },
              };
            } else {
              if (toolDelta.id) toolCalls[index].id = toolDelta.id;
              if (toolDelta.type) toolCalls[index].type = toolDelta.type;
              if (toolDelta.function?.name) toolCalls[index].function.name = toolDelta.function.name;
              if (toolDelta.function?.arguments) {
                toolCalls[index].function.arguments += toolDelta.function.arguments;
              }
            }
          }
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

    const finalizedToolCalls = toolCalls.filter((call) => call.function.name);

    return { content, usage, toolCalls: finalizedToolCalls.length > 0 ? finalizedToolCalls : undefined };
  }
}

const extractReasoningText = (detail: unknown): string | null => {
  if (!detail) return null;
  if (typeof detail === 'string') return detail;
  if (typeof detail === 'object') {
    const record = detail as Record<string, unknown>;
    if (typeof record.text === 'string') return record.text;
    if (typeof record.reasoning === 'string') return record.reasoning;
    if (typeof record.summary === 'string') return record.summary;
    if (Array.isArray(record.summary)) {
      return record.summary.filter((item) => typeof item === 'string').join('\n');
    }
    if (typeof record.content === 'string') return record.content;
  }
  return null;
};
