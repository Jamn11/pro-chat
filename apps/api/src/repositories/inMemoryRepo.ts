import { randomUUID } from 'crypto';
import {
  AttachmentRecord,
  MessageRecord,
  ModelInfo,
  ThreadRecord,
  ThreadSummary,
} from '../types';
import {
  ChatRepository,
  CreateAttachmentInput,
  CreateMessageInput,
  CreateThreadInput,
  SettingsRecord,
} from './types';

export class InMemoryChatRepository implements ChatRepository {
  private userId = randomUUID();
  private systemPrompt: string | null = null;
  private models = new Map<string, ModelInfo>();
  private threads = new Map<string, ThreadRecord>();
  private messages = new Map<string, MessageRecord>();
  private attachments = new Map<string, AttachmentRecord>();

  async ensureDefaultUser(): Promise<string> {
    return this.userId;
  }

  async getSettings(): Promise<SettingsRecord> {
    return { systemPrompt: this.systemPrompt };
  }

  async updateSettings(systemPrompt: string | null): Promise<SettingsRecord> {
    this.systemPrompt = systemPrompt;
    return { systemPrompt };
  }

  async listModels(): Promise<ModelInfo[]> {
    return [...this.models.values()];
  }

  async upsertModels(models: ModelInfo[]): Promise<void> {
    for (const model of models) {
      this.models.set(model.id, model);
    }
  }

  async listThreads(): Promise<ThreadSummary[]> {
    return [...this.threads.values()].map((thread) => ({
      id: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      totalCost: thread.totalCost,
    }));
  }

  async createThread(input: CreateThreadInput): Promise<ThreadRecord> {
    const thread: ThreadRecord = {
      id: randomUUID(),
      title: input.title ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
      totalCost: 0,
    };
    this.threads.set(thread.id, thread);
    return thread;
  }

  async updateThreadTitle(threadId: string, title: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (thread) {
      thread.title = title;
      thread.updatedAt = new Date();
      this.threads.set(threadId, thread);
    }
  }

  async deleteThread(threadId: string): Promise<void> {
    this.threads.delete(threadId);
    for (const [id, message] of this.messages) {
      if (message.threadId === threadId) this.messages.delete(id);
    }
    for (const [id, attachment] of this.attachments) {
      if (attachment.threadId === threadId) this.attachments.delete(id);
    }
  }

  async getThreadMessages(threadId: string): Promise<MessageRecord[]> {
    const list = [...this.messages.values()].filter((m) => m.threadId === threadId);
    return list
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((message) => ({
        ...message,
        attachments: [...this.attachments.values()].filter((a) => a.messageId === message.id),
      }));
  }

  async createMessage(input: CreateMessageInput): Promise<MessageRecord> {
    const message: MessageRecord = {
      id: randomUUID(),
      threadId: input.threadId,
      role: input.role,
      content: input.content,
      modelId: input.modelId ?? null,
      thinkingLevel: input.thinkingLevel ?? null,
      createdAt: new Date(),
      durationMs: input.durationMs ?? null,
      promptTokens: input.promptTokens ?? null,
      completionTokens: input.completionTokens ?? null,
      cost: input.cost ?? 0,
    };
    this.messages.set(message.id, message);
    return message;
  }

  async updateMessage(id: string, data: Partial<CreateMessageInput>): Promise<MessageRecord> {
    const message = this.messages.get(id);
    if (!message) throw new Error('Message not found');
    const updated: MessageRecord = {
      ...message,
      content: data.content ?? message.content,
      modelId: data.modelId ?? message.modelId,
      thinkingLevel: data.thinkingLevel ?? message.thinkingLevel,
      durationMs: data.durationMs ?? message.durationMs,
      promptTokens: data.promptTokens ?? message.promptTokens,
      completionTokens: data.completionTokens ?? message.completionTokens,
      cost: data.cost ?? message.cost,
    };
    this.messages.set(id, updated);
    return updated;
  }

  async incrementThreadCost(threadId: string, delta: number): Promise<number> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error('Thread not found');
    thread.totalCost += delta;
    thread.updatedAt = new Date();
    this.threads.set(threadId, thread);
    return thread.totalCost;
  }

  async createAttachment(input: CreateAttachmentInput): Promise<AttachmentRecord> {
    const attachment: AttachmentRecord = {
      id: randomUUID(),
      threadId: input.threadId,
      messageId: null,
      filename: input.filename,
      path: input.path,
      mimeType: input.mimeType,
      size: input.size,
      kind: input.kind,
      createdAt: new Date(),
    };
    this.attachments.set(attachment.id, attachment);
    return attachment;
  }

  async attachAttachmentsToMessage(messageId: string, attachmentIds: string[]): Promise<void> {
    for (const id of attachmentIds) {
      const attachment = this.attachments.get(id);
      if (attachment) {
        attachment.messageId = messageId;
        this.attachments.set(id, attachment);
      }
    }
  }

  async getAttachmentsByIds(ids: string[]): Promise<AttachmentRecord[]> {
    return ids.map((id) => this.attachments.get(id)).filter(Boolean) as AttachmentRecord[];
  }

  async listAttachmentsForThread(threadId: string): Promise<AttachmentRecord[]> {
    return [...this.attachments.values()].filter((a) => a.threadId === threadId);
  }
}
