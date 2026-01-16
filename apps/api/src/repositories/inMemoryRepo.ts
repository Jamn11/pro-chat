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
  CreateUsageRecordInput,
  SettingsRecord,
  UsageRecord,
  UsageStats,
} from './types';

type InternalThread = ThreadRecord & { memoryCheckedAt: Date | null };

export class InMemoryChatRepository implements ChatRepository {
  private userId = randomUUID();
  private settings: SettingsRecord = {
    systemPrompt: null,
    defaultModelId: null,
    defaultThinkingLevel: null,
    enabledModelIds: [],
    enabledTools: ['web_search', 'code_interpreter', 'memory'],
    hideCostPerMessage: false,
    notifications: true,
    fontFamily: 'Space Mono',
    fontSize: 'medium',
  };
  private models = new Map<string, ModelInfo>();
  private threads = new Map<string, InternalThread>();
  private messages = new Map<string, MessageRecord>();
  private attachments = new Map<string, AttachmentRecord>();
  private usageRecords: UsageRecord[] = [];

  async ensureDefaultUser(): Promise<string> {
    return this.userId;
  }

  async getSettings(): Promise<SettingsRecord> {
    return { ...this.settings };
  }

  async updateSettings(newSettings: Partial<SettingsRecord>): Promise<SettingsRecord> {
    this.settings = { ...this.settings, ...newSettings };
    return { ...this.settings };
  }

  async getUsageStats(): Promise<UsageStats> {
    const costByModel: Record<string, number> = {};
    const messagesByModel: Record<string, number> = {};
    const costsByDate = new Map<string, number>();
    let totalCost = 0;

    // Use usage records for stats (persists even when chats are deleted)
    for (const record of this.usageRecords) {
      totalCost += record.cost;
      costByModel[record.modelId] = (costByModel[record.modelId] || 0) + record.cost;
      messagesByModel[record.modelId] = (messagesByModel[record.modelId] || 0) + 1;
      const date = record.createdAt.toISOString().split('T')[0];
      costsByDate.set(date, (costsByDate.get(date) || 0) + record.cost);
    }

    const dailyCosts: Array<{ date: string; cost: number }> = [];
    for (const [date, cost] of costsByDate) {
      dailyCosts.push({ date, cost });
    }
    dailyCosts.sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalCost,
      totalMessages: this.usageRecords.length,
      totalThreads: this.threads.size,
      costByModel,
      messagesByModel,
      dailyCosts,
    };
  }

  async createUsageRecord(input: CreateUsageRecordInput): Promise<UsageRecord> {
    const record: UsageRecord = {
      id: randomUUID(),
      modelId: input.modelId,
      cost: input.cost,
      promptTokens: input.promptTokens,
      completionTokens: input.completionTokens,
      createdAt: new Date(),
    };
    this.usageRecords.push(record);
    return record;
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
      memoryCheckedAt: thread.memoryCheckedAt,
    }));
  }

  async createThread(input: CreateThreadInput): Promise<ThreadRecord> {
    const thread: InternalThread = {
      id: randomUUID(),
      title: input.title ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
      totalCost: 0,
      memoryCheckedAt: null,
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
      trace: input.trace ?? null,
      sources: input.sources ?? null,
    };
    this.messages.set(message.id, message);
    // Update thread updatedAt
    const thread = this.threads.get(input.threadId);
    if (thread) {
      thread.updatedAt = new Date();
      this.threads.set(input.threadId, thread);
    }
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
      trace: data.trace === undefined ? message.trace : data.trace,
      sources: data.sources === undefined ? message.sources : data.sources,
    };
    this.messages.set(id, updated);
    return updated;
  }

  async pruneMessageArtifacts(before: Date): Promise<number> {
    let count = 0;
    for (const [id, message] of this.messages) {
      if (message.createdAt < before) {
        message.trace = null;
        message.sources = null;
        this.messages.set(id, message);
        count++;
      }
    }
    return count;
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

  async getThreadsForMemoryExtraction(): Promise<ThreadSummary[]> {
    const allThreads = [...this.threads.values()];
    // Filter threads that need memory extraction:
    // - Have at least one message
    // - Either never checked, or updated after the last check
    const threadsWithMessages = allThreads.filter((thread) => {
      const hasMessages = [...this.messages.values()].some((m) => m.threadId === thread.id);
      if (!hasMessages) return false;
      if (!thread.memoryCheckedAt) return true;
      return thread.updatedAt > thread.memoryCheckedAt;
    });
    return threadsWithMessages.map((thread) => ({
      id: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      totalCost: thread.totalCost,
      memoryCheckedAt: thread.memoryCheckedAt,
    }));
  }

  async markThreadMemoryChecked(threadId: string): Promise<void> {
    const thread = this.threads.get(threadId);
    if (thread) {
      thread.memoryCheckedAt = new Date();
      this.threads.set(threadId, thread);
    }
  }
}
