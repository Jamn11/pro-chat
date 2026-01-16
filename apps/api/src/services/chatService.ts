import { randomUUID } from 'crypto';
import { ChatRepository } from '../repositories/types';
import { buildUserContent } from '../utils/attachments';
import { calculateCost } from '../utils/cost';
import {
  OpenRouterClient,
  OpenRouterMessage,
  OpenRouterToolCall,
  OpenRouterToolDefinition,
} from './openrouter';
import { MessageRecord, MessageSource, ThinkingLevel, TraceEvent } from '../types';
import { resolveThinkingConfig } from '../utils/thinking';
import { MemoryStore } from './memoryStore';
import {
  MemoryTool,
  MEMORY_APPEND_TOOL_NAME,
  MEMORY_WRITE_TOOL_NAME,
  memoryAppendToolDefinition,
  memoryWriteToolDefinition,
} from './memoryTool';
import { PYTHON_TOOL_NAME, PythonTool, pythonToolDefinition } from './pythonTool';
import { SEARCH_TOOL_NAME, SearchTool, searchToolDefinition } from './searchTool';
import { WEB_FETCH_TOOL_NAME, WebFetchTool, webFetchToolDefinition } from './webFetchTool';

export type SendMessageInput = {
  userId: string;
  threadId: string;
  content: string;
  modelId: string;
  thinkingLevel?: ThinkingLevel | null;
  attachmentIds?: string[];
  clientContext?: {
    iso: string;
    local: string;
    timeZone?: string;
    offsetMinutes?: number;
  };
};

type SendMessageCallbacks = {
  onToolStart?: (toolName: string) => void;
  onReasoning?: (delta: string) => void;
  onToolResult?: (toolName: string, result: string) => void;
};

export type SendMessageResult = {
  userMessage: MessageRecord;
  assistantMessage: MessageRecord;
  totalCost: number;
  promptTokens?: number;
  completionTokens?: number;
  durationMs: number;
};

type ChatServiceOptions = {
  memoryStore?: MemoryStore;
  pythonTool?: PythonTool;
  searchTool?: SearchTool;
  webFetchTool?: WebFetchTool;
  maxToolIterations?: number;
  tracePolicy?: Partial<TracePolicy>;
};

type TracePolicy = {
  maxEvents: number;
  maxChars: number;
  maxSources: number;
  maxSourceChars: number;
  maxSourceSnippetChars: number;
  retentionDays: number;
};

const DEFAULT_TRACE_POLICY: TracePolicy = {
  maxEvents: 120,
  maxChars: 50_000,
  maxSources: 40,
  maxSourceChars: 40_000,
  maxSourceSnippetChars: 600,
  retentionDays: 30,
};

export class ChatService {
  private memoryTool?: MemoryTool;

  constructor(
    private repo: ChatRepository,
    private openRouter: OpenRouterClient,
    private storageRoot: string,
    private options: ChatServiceOptions = {},
  ) {
    if (options.memoryStore) {
      this.memoryTool = new MemoryTool(options.memoryStore);
    }
  }

  private async generateTitle(threadId: string, firstMessage: string): Promise<void> {
    const TITLE_MODEL = 'anthropic/claude-haiku-4.5';
    const prompt = `Generate a short, descriptive title (3-6 words) for a chat conversation that starts with this message. Return only the title, no quotes or punctuation at the end.

User's first message:
${firstMessage.slice(0, 500)}`;

    try {
      const result = await this.openRouter.chat({
        model: TITLE_MODEL,
        messages: [{ role: 'user', content: prompt }],
        maxTokens: 30,
      });

      const title = result.content.trim().slice(0, 100);
      if (title) {
        await this.repo.updateThreadTitle(threadId, title);
      }
    } catch (error) {
      // Fallback to simple truncation if LLM fails
      const fallbackTitle = firstMessage.trim().slice(0, 60);
      if (fallbackTitle) {
        await this.repo.updateThreadTitle(threadId, fallbackTitle);
      }
      throw error;
    }
  }

  async sendMessageStream(
    input: SendMessageInput,
    onDelta: (chunk: string) => void,
    signal?: AbortSignal,
    callbacks?: SendMessageCallbacks,
  ): Promise<SendMessageResult> {
    if (!input.content.trim()) {
      throw new Error('Message content required');
    }
    if (!input.threadId) {
      throw new Error('Thread ID required');
    }

    const requestedAttachments = await this.repo.getAttachmentsByIds(input.attachmentIds ?? []);
    const attachments = requestedAttachments.filter(
      (attachment) => attachment.threadId === input.threadId,
    );
    if (requestedAttachments.length !== attachments.length) {
      throw new Error('Invalid attachment selection');
    }
    const modelList = await this.repo.listModels();
    const model = modelList.find((m) => m.id === input.modelId);
    if (!model) {
      throw new Error('Model not found');
    }

    const threads = await this.repo.listThreads(input.userId);
    const thread = threads.find((t) => t.id === input.threadId);
    if (!thread) {
      throw new Error('Thread not found');
    }
    if (!thread.title) {
      // Generate title asynchronously using LLM (don't await to not block message sending)
      this.generateTitle(input.threadId, input.content).catch((err) => {
        console.error('Failed to generate chat title:', err);
      });
    }

    const userMessage = await this.repo.createMessage({
      threadId: input.threadId,
      role: 'user',
      content: input.content,
      modelId: model.id,
      thinkingLevel: input.thinkingLevel ?? null,
    });

    if (attachments.length > 0) {
      await this.repo.attachAttachmentsToMessage(userMessage.id, attachments.map((a) => a.id));
    }

    const settings = await this.repo.getSettings(input.userId);
    const history = await this.repo.getThreadMessages(input.threadId);
    const systemPrompt = settings.systemPrompt?.trim();
    const memory = await this.options.memoryStore?.read();
    const isNewThread = history.length <= 1;
    const tracePolicy = resolveTracePolicy(this.options.tracePolicy);

    if (tracePolicy.retentionDays > 0) {
      const cutoff = new Date(Date.now() - tracePolicy.retentionDays * 24 * 60 * 60 * 1000);
      await this.repo.pruneMessageArtifacts(cutoff);
    }

    let trace: TraceEvent[] = [];
    let sources: MessageSource[] = [];

    const openRouterMessages: OpenRouterMessage[] = [];
    if (systemPrompt) {
      openRouterMessages.push({ role: 'system', content: systemPrompt });
    }
    if (isNewThread) {
      if (input.clientContext?.iso || input.clientContext?.local) {
        const parts = [
          input.clientContext.local ? `Client date/time: ${input.clientContext.local}` : null,
          input.clientContext.timeZone ? `Timezone: ${input.clientContext.timeZone}` : null,
          input.clientContext.offsetMinutes != null
            ? `UTC offset minutes: ${input.clientContext.offsetMinutes}`
            : null,
          input.clientContext.iso ? `ISO 8601: ${input.clientContext.iso}` : null,
        ].filter(Boolean);
        openRouterMessages.push({
          role: 'system',
          content: parts.join(' · '),
        });
      } else {
        const now = new Date();
        openRouterMessages.push({
          role: 'system',
          content: `Current date/time (server): ${now.toISOString()}.`,
        });
      }
    }
    if (memory) {
      openRouterMessages.push({
        role: 'system',
        content: `Memory:\n${memory}`,
      });
    }

    for (const message of history) {
      if (message.id === userMessage.id) continue;
      if (message.role === 'user') {
        openRouterMessages.push({ role: 'user', content: message.content });
      } else if (message.role === 'assistant') {
        openRouterMessages.push({ role: 'assistant', content: message.content });
      }
    }

    const content = await buildUserContent(
      input.content,
      attachments,
      model.supportsVision,
      this.storageRoot,
    );
    openRouterMessages.push({ role: 'user', content });

    const start = Date.now();
    const { reasoning, maxTokens } = resolveThinkingConfig(model, input.thinkingLevel ?? null);
    const toolHandlers = this.getToolHandlers();
    const tools = toolHandlers.map((handler) => handler.definition);
    const maxToolIterations = this.options.maxToolIterations ?? 4;

    let promptTokens = 0;
    let completionTokens = 0;
    let finalContent = '';
    let iterations = 0;

    const handleReasoning = (delta: string) => {
      if (delta) {
        trace = appendTraceEvent(
          trace,
          createTraceEvent('reasoning', delta),
          tracePolicy,
        );
      }
      callbacks?.onReasoning?.(delta);
    };

    const handleToolStart = (toolName: string) => {
      trace = appendTraceEvent(
        trace,
        createTraceEvent('tool', `Tool: ${toolName}`),
        tracePolicy,
      );
      callbacks?.onToolStart?.(toolName);
    };

    const handleToolResult = (toolName: string, result: string) => {
      const nextSources = extractSourcesFromToolResult(
        toolName,
        result,
        tracePolicy.maxSourceSnippetChars,
      );
      if (nextSources.length > 0) {
        sources = appendSources(sources, nextSources, tracePolicy);
      }
      callbacks?.onToolResult?.(toolName, result);
    };

    while (iterations <= maxToolIterations) {
      const result = await this.openRouter.streamChat(
        {
          model: model.id,
          messages: openRouterMessages,
          reasoning,
          maxTokens,
          tools,
          toolChoice: tools.length > 0 ? 'auto' : undefined,
          signal,
        },
        {
          onDelta,
          onReasoning: handleReasoning,
        },
      );

      promptTokens += result.usage?.prompt_tokens ?? 0;
      completionTokens += result.usage?.completion_tokens ?? 0;

      const toolCalls = result.toolCalls ?? [];
      if (toolCalls.length === 0) {
        finalContent = result.content;
        break;
      }

      if (toolHandlers.length === 0) {
        throw new Error('Tool call requested but no tools are configured.');
      }

      openRouterMessages.push({
        role: 'assistant',
        content: result.content ?? '',
        tool_calls: toolCalls,
      });

      const toolMessages = await this.runToolCalls(toolHandlers, toolCalls, {
        onToolStart: handleToolStart,
        onToolResult: handleToolResult,
      });
      openRouterMessages.push(...toolMessages);

      iterations += 1;
    }

    if (!finalContent && iterations > maxToolIterations) {
      throw new Error('Tool call limit exceeded.');
    }

    const durationMs = Date.now() - start;
    const cost = calculateCost(promptTokens, completionTokens, model);

    const assistantMessage = await this.repo.createMessage({
      threadId: input.threadId,
      role: 'assistant',
      content: finalContent,
      modelId: model.id,
      thinkingLevel: input.thinkingLevel ?? null,
      durationMs,
      promptTokens: promptTokens || null,
      completionTokens: completionTokens || null,
      cost,
      trace: trace.length > 0 ? trace : null,
      sources: sources.length > 0 ? sources : null,
    });

    const totalCost = await this.repo.incrementThreadCost(input.threadId, cost);

    return {
      userMessage,
      assistantMessage,
      totalCost,
      promptTokens: promptTokens || undefined,
      completionTokens: completionTokens || undefined,
      durationMs,
    };
  }

  private getToolHandlers(): Array<{
    name: string;
    definition: OpenRouterToolDefinition;
    run: (toolCall: OpenRouterToolCall) => Promise<string>;
  }> {
    const handlers: Array<{
      name: string;
      definition: OpenRouterToolDefinition;
      run: (toolCall: OpenRouterToolCall) => Promise<string>;
    }> = [];

    // Memory tools
    if (this.memoryTool) {
      handlers.push({
        name: MEMORY_APPEND_TOOL_NAME,
        definition: memoryAppendToolDefinition,
        run: (toolCall) => this.memoryTool!.runToolCall(toolCall),
      });
      handlers.push({
        name: MEMORY_WRITE_TOOL_NAME,
        definition: memoryWriteToolDefinition,
        run: (toolCall) => this.memoryTool!.runToolCall(toolCall),
      });
    }

    // Python tool
    if (this.options.pythonTool) {
      handlers.push({
        name: PYTHON_TOOL_NAME,
        definition: pythonToolDefinition,
        run: (toolCall) => this.options.pythonTool!.runToolCall(toolCall),
      });
    }

    // Search tool
    if (this.options.searchTool) {
      handlers.push({
        name: SEARCH_TOOL_NAME,
        definition: searchToolDefinition,
        run: (toolCall) => this.options.searchTool!.runToolCall(toolCall),
      });
    }

    // Web fetch tool
    if (this.options.webFetchTool) {
      handlers.push({
        name: WEB_FETCH_TOOL_NAME,
        definition: webFetchToolDefinition,
        run: (toolCall) => this.options.webFetchTool!.runToolCall(toolCall),
      });
    }

    return handlers;
  }

  private async runToolCalls(
    toolHandlers: Array<{
      name: string;
      definition: OpenRouterToolDefinition;
      run: (toolCall: OpenRouterToolCall) => Promise<string>;
    }>,
    toolCalls: OpenRouterToolCall[],
    callbacks?: SendMessageCallbacks,
  ): Promise<OpenRouterMessage[]> {
    const handlerMap = new Map(toolHandlers.map((handler) => [handler.name, handler]));
    const toolMessages: OpenRouterMessage[] = [];
    for (const toolCall of toolCalls) {
      callbacks?.onToolStart?.(toolCall.function.name);
      const handler = handlerMap.get(toolCall.function.name);
      if (!handler) {
        toolMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify({ error: `Unsupported tool: ${toolCall.function.name}` }),
        });
        continue;
      }
      const result = await handler.run(toolCall);
      callbacks?.onToolResult?.(toolCall.function.name, result);
      toolMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: result,
      });
    }
    return toolMessages;
  }
}

const resolveTracePolicy = (input?: Partial<TracePolicy>): TracePolicy => {
  const policy = {
    maxEvents: input?.maxEvents ?? DEFAULT_TRACE_POLICY.maxEvents,
    maxChars: input?.maxChars ?? DEFAULT_TRACE_POLICY.maxChars,
    maxSources: input?.maxSources ?? DEFAULT_TRACE_POLICY.maxSources,
    maxSourceChars: input?.maxSourceChars ?? DEFAULT_TRACE_POLICY.maxSourceChars,
    maxSourceSnippetChars:
      input?.maxSourceSnippetChars ?? DEFAULT_TRACE_POLICY.maxSourceSnippetChars,
    retentionDays: input?.retentionDays ?? DEFAULT_TRACE_POLICY.retentionDays,
  };
  return {
    maxEvents: Number.isFinite(policy.maxEvents) ? Math.max(0, Math.floor(policy.maxEvents)) : 0,
    maxChars: Number.isFinite(policy.maxChars) ? Math.max(0, Math.floor(policy.maxChars)) : 0,
    maxSources: Number.isFinite(policy.maxSources) ? Math.max(0, Math.floor(policy.maxSources)) : 0,
    maxSourceChars: Number.isFinite(policy.maxSourceChars)
      ? Math.max(0, Math.floor(policy.maxSourceChars))
      : 0,
    maxSourceSnippetChars: Number.isFinite(policy.maxSourceSnippetChars)
      ? Math.max(0, Math.floor(policy.maxSourceSnippetChars))
      : 0,
    retentionDays: Number.isFinite(policy.retentionDays)
      ? Math.max(0, Math.floor(policy.retentionDays))
      : 0,
  };
};

const createTraceEvent = (type: TraceEvent['type'], content: string): TraceEvent => ({
  id: randomUUID(),
  type,
  content,
  createdAt: new Date().toISOString(),
});

const appendTraceEvent = (
  trace: TraceEvent[],
  next: TraceEvent,
  policy: TracePolicy,
): TraceEvent[] => {
  if (!next.content) return trace;
  let updated = trace;
  if (next.type === 'reasoning' && trace.length > 0) {
    const last = trace[trace.length - 1];
    if (last.type === 'reasoning') {
      updated = [...trace.slice(0, -1), { ...last, content: `${last.content}${next.content}` }];
    } else {
      updated = [...trace, next];
    }
  } else {
    updated = [...trace, next];
  }

  if (policy.maxEvents === 0 || policy.maxChars === 0) {
    return [];
  }

  if (updated.length > policy.maxEvents) {
    updated = updated.slice(updated.length - policy.maxEvents);
  }

  const maxChars = policy.maxChars;
  let totalChars = updated.reduce((sum, event) => sum + event.content.length, 0);
  if (totalChars > maxChars) {
    while (updated.length > 0 && totalChars > maxChars) {
      totalChars -= updated[0].content.length;
      updated = updated.slice(1);
    }
    if (updated.length === 0) {
      return [];
    }
    if (totalChars > maxChars) {
      const last = updated[updated.length - 1];
      updated[updated.length - 1] = {
        ...last,
        content: last.content.slice(-maxChars),
      };
    }
  }

  return updated;
};

const extractSourcesFromToolResult = (
  toolName: string,
  result: string,
  maxSnippetChars: number,
): MessageSource[] => {
  // Memory tools don't produce sources
  if (toolName === MEMORY_APPEND_TOOL_NAME || toolName === MEMORY_WRITE_TOOL_NAME) {
    return [];
  }

  // Python tool doesn't produce sources
  if (toolName === PYTHON_TOOL_NAME) {
    return [];
  }

  let parsed: any = null;
  try {
    parsed = JSON.parse(result);
  } catch (_error) {
    return [];
  }

  const now = new Date().toISOString();

  if (toolName === SEARCH_TOOL_NAME) {
    const results = Array.isArray(parsed?.results) ? parsed.results : [];
    return results
      .filter((entry: any) => entry && typeof entry.url === 'string')
      .map((entry: any) => ({
        id: randomUUID(),
        kind: 'search',
        title: typeof entry.title === 'string' ? entry.title : entry.url,
        url: entry.url,
        snippet: trimSnippet(entry.snippet, maxSnippetChars),
        createdAt: now,
      }));
  }

  if (toolName === WEB_FETCH_TOOL_NAME) {
    if (parsed?.error) return [];
    if (typeof parsed?.url !== 'string') return [];
    return [
      {
        id: randomUUID(),
        kind: 'web',
        title: typeof parsed?.title === 'string' && parsed.title.trim().length > 0 ? parsed.title : parsed.url,
        url: parsed.url,
        snippet: trimSnippet(parsed.text, maxSnippetChars),
        status: typeof parsed?.status === 'number' ? parsed.status : null,
        contentType: typeof parsed?.contentType === 'string' ? parsed.contentType : null,
        createdAt: now,
      },
    ];
  }

  return [];
};

const appendSources = (
  existing: MessageSource[],
  incoming: MessageSource[],
  policy: TracePolicy,
): MessageSource[] => {
  if (policy.maxSources === 0 || policy.maxSourceChars === 0) {
    return [];
  }

  const map = new Map<string, MessageSource>();
  for (const source of existing) {
    map.set(source.url, source);
  }
  for (const source of incoming) {
    if (!map.has(source.url)) {
      map.set(source.url, source);
    }
  }
  let merged = [...map.values()];

  if (merged.length > policy.maxSources) {
    merged = merged.slice(merged.length - policy.maxSources);
  }

  const maxChars = policy.maxSourceChars;
  let totalChars = merged.reduce((sum, source) => {
    const snippet = source.snippet ?? '';
    return sum + source.title.length + snippet.length;
  }, 0);
  if (totalChars > maxChars) {
    while (merged.length > 0 && totalChars > maxChars) {
      const [first] = merged;
      totalChars -= first.title.length + (first.snippet?.length ?? 0);
      merged = merged.slice(1);
    }
    if (merged.length === 0) return [];
    if (totalChars > maxChars) {
      const last = merged[merged.length - 1];
      const allowed = Math.max(0, maxChars - last.title.length);
      merged[merged.length - 1] = {
        ...last,
        snippet: trimSnippet(last.snippet, allowed),
      };
    }
  }

  return merged;
};

const trimSnippet = (snippet: unknown, maxChars: number): string | undefined => {
  if (typeof snippet !== 'string') return undefined;
  if (maxChars <= 0) return undefined;
  const trimmed = snippet.trim();
  if (!trimmed) return undefined;
  if (trimmed.length <= maxChars) return trimmed;
  return trimmed.slice(0, maxChars).trim();
};
