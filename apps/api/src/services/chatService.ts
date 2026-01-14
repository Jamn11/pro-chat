import { ChatRepository } from '../repositories/types';
import { buildUserContent } from '../utils/attachments';
import { calculateCost } from '../utils/cost';
import { OpenRouterClient } from './openrouter';
import { MessageRecord, ThinkingLevel } from '../types';
import { resolveThinkingConfig } from '../utils/thinking';

export type SendMessageInput = {
  threadId: string;
  content: string;
  modelId: string;
  thinkingLevel?: ThinkingLevel | null;
  attachmentIds?: string[];
};

export type SendMessageResult = {
  userMessage: MessageRecord;
  assistantMessage: MessageRecord;
  totalCost: number;
  promptTokens?: number;
  completionTokens?: number;
  durationMs: number;
};

export class ChatService {
  constructor(
    private repo: ChatRepository,
    private openRouter: OpenRouterClient,
    private storageRoot: string,
  ) {}

  async sendMessageStream(
    input: SendMessageInput,
    onDelta: (chunk: string) => void,
    signal?: AbortSignal,
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

    const threads = await this.repo.listThreads();
    const thread = threads.find((t) => t.id === input.threadId);
    if (!thread) {
      throw new Error('Thread not found');
    }
    if (!thread.title) {
      const title = input.content.trim().slice(0, 60);
      if (title) {
        await this.repo.updateThreadTitle(input.threadId, title);
      }
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

    const settings = await this.repo.getSettings();
    const history = await this.repo.getThreadMessages(input.threadId);
    const systemPrompt = settings.systemPrompt?.trim();

    const openRouterMessages = [] as Parameters<OpenRouterClient['streamChat']>[0]['messages'];
    if (systemPrompt) {
      openRouterMessages.push({ role: 'system', content: systemPrompt });
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
    const result = await this.openRouter.streamChat(
      {
        model: model.id,
        messages: openRouterMessages,
        reasoning,
        maxTokens,
        signal,
      },
      onDelta,
    );
    const durationMs = Date.now() - start;

    const promptTokens = result.usage?.prompt_tokens ?? null;
    const completionTokens = result.usage?.completion_tokens ?? null;
    const cost = calculateCost(promptTokens, completionTokens, model);

    const assistantMessage = await this.repo.createMessage({
      threadId: input.threadId,
      role: 'assistant',
      content: result.content,
      modelId: model.id,
      thinkingLevel: input.thinkingLevel ?? null,
      durationMs,
      promptTokens,
      completionTokens,
      cost,
    });

    const totalCost = await this.repo.incrementThreadCost(input.threadId, cost);

    return {
      userMessage,
      assistantMessage,
      totalCost,
      promptTokens: promptTokens ?? undefined,
      completionTokens: completionTokens ?? undefined,
      durationMs,
    };
  }
}
