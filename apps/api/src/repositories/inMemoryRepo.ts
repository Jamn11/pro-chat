import { randomUUID } from 'crypto';
import {
  ActiveStreamRecord,
  AttachmentRecord,
  MessageRecord,
  ModelInfo,
  StreamStatus,
  ThreadRecord,
  ThreadSummary,
  ThinkingLevel,
  TraceEvent,
} from '../types';
import {
  ChatRepository,
  CreateActiveStreamInput,
  CreateAttachmentInput,
  CreateMessageInput,
  CreateThreadInput,
  CreateUsageRecordInput,
  SettingsRecord,
  UserRecord,
  UpsertUserFromClerkInput,
  UpdateActiveStreamInput,
  UsageRecord,
  UsageStats,
} from './types';

type InternalThread = ThreadRecord & { memoryCheckedAt: Date | null };

type InternalUser = UserRecord;

type InternalActiveStream = {
  id: string;
  threadId: string;
  userMessageId: string;
  assistantMessageId: string | null;
  status: StreamStatus;
  partialContent: string;
  partialTrace: TraceEvent[] | null;
  modelId: string;
  thinkingLevel: ThinkingLevel | null;
  startedAt: Date;
  lastActivityAt: Date;
  completedAt: Date | null;
};

export class InMemoryChatRepository implements ChatRepository {
  private users = new Map<string, InternalUser>();
  // Store additional settings in memory (systemPrompt goes to user record)
  private additionalSettings: Omit<SettingsRecord, 'systemPrompt'> = {
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
  private activeStreams = new Map<string, InternalActiveStream>();
  // Store usage records in memory (persists across chat deletions within session)
  private usageRecords: UsageRecord[] = [];

  // User management (Clerk integration)
  async findUserByClerkId(clerkId: string): Promise<UserRecord | null> {
    for (const user of this.users.values()) {
      if (user.clerkId === clerkId) return user;
    }
    return null;
  }

  async upsertUserFromClerk(input: UpsertUserFromClerkInput): Promise<UserRecord> {
    const existing = await this.findUserByClerkId(input.clerkId);
    if (existing) {
      const updated: InternalUser = {
        ...existing,
        email: input.email ?? existing.email,
        firstName: input.firstName ?? existing.firstName,
        lastName: input.lastName ?? existing.lastName,
        imageUrl: input.imageUrl ?? existing.imageUrl,
        updatedAt: new Date(),
        lastSignInAt: new Date(),
      };
      this.users.set(updated.id, updated);
      return updated;
    }
    const newUser: InternalUser = {
      id: randomUUID(),
      clerkId: input.clerkId,
      email: input.email ?? null,
      firstName: input.firstName ?? null,
      lastName: input.lastName ?? null,
      imageUrl: input.imageUrl ?? null,
      systemPrompt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignInAt: new Date(),
    };
    this.users.set(newUser.id, newUser);
    return newUser;
  }

  // Settings (per-user)
  async getSettings(userId: string): Promise<SettingsRecord> {
    const user = this.users.get(userId);
    return {
      systemPrompt: user?.systemPrompt ?? null,
      ...this.additionalSettings,
    };
  }

  async updateSettings(userId: string, settings: Partial<SettingsRecord>): Promise<SettingsRecord> {
    // Update systemPrompt on user record if provided
    if (settings.systemPrompt !== undefined) {
      const user = this.users.get(userId);
      if (user) {
        user.systemPrompt = settings.systemPrompt;
        this.users.set(userId, user);
      }
    }
    // Update other settings in additionalSettings
    const { systemPrompt: _sp, ...rest } = settings;
    this.additionalSettings = { ...this.additionalSettings, ...rest };
    return this.getSettings(userId);
  }

  // Usage stats (per-user)
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getUsageStats(_userId: string): Promise<UsageStats> {
    const costByModel: Record<string, number> = {};
    const messagesByModel: Record<string, number> = {};
    const statsByDate = new Map<string, { cost: number; messages: number }>();
    let totalCost = 0;

    // Use usage records for stats (persists even when chats are deleted)
    for (const record of this.usageRecords) {
      totalCost += record.cost;
      costByModel[record.modelId] = (costByModel[record.modelId] || 0) + record.cost;
      messagesByModel[record.modelId] = (messagesByModel[record.modelId] || 0) + 1;
      const date = record.createdAt.toISOString().split('T')[0];
      const existing = statsByDate.get(date) || { cost: 0, messages: 0 };
      statsByDate.set(date, {
        cost: existing.cost + record.cost,
        messages: existing.messages + 1,
      });
    }

    const dailyStats: Array<{ date: string; cost: number; messages: number }> = [];
    for (const [date, stats] of statsByDate) {
      dailyStats.push({ date, ...stats });
    }
    dailyStats.sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalCost,
      totalMessages: this.usageRecords.length,
      totalThreads: this.threads.size,
      costByModel,
      messagesByModel,
      dailyStats,
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

  async listThreads(_userId: string): Promise<ThreadSummary[]> {
    // In-memory repo doesn't filter by user for simplicity in tests
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

  async getThreadsForMemoryExtraction(_userId: string): Promise<ThreadSummary[]> {
    // In-memory repo doesn't filter by user for simplicity in tests
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

  // Active stream methods

  async createActiveStream(input: CreateActiveStreamInput): Promise<ActiveStreamRecord> {
    const stream: InternalActiveStream = {
      id: randomUUID(),
      threadId: input.threadId,
      userMessageId: input.userMessageId,
      assistantMessageId: null,
      status: 'active',
      partialContent: '',
      partialTrace: null,
      modelId: input.modelId,
      thinkingLevel: input.thinkingLevel ?? null,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      completedAt: null,
    };
    this.activeStreams.set(stream.id, stream);
    return stream;
  }

  async getActiveStream(id: string): Promise<ActiveStreamRecord | null> {
    return this.activeStreams.get(id) ?? null;
  }

  async getActiveStreamByThread(threadId: string): Promise<ActiveStreamRecord | null> {
    const streams = [...this.activeStreams.values()].filter(
      (s) => s.threadId === threadId && (s.status === 'active' || s.status === 'pending'),
    );
    if (streams.length === 0) return null;
    // Return the most recent one
    return streams.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];
  }

  async updateActiveStream(id: string, data: UpdateActiveStreamInput): Promise<ActiveStreamRecord> {
    const stream = this.activeStreams.get(id);
    if (!stream) throw new Error('Active stream not found');
    const updated: InternalActiveStream = {
      ...stream,
      assistantMessageId: data.assistantMessageId ?? stream.assistantMessageId,
      status: data.status ?? stream.status,
      partialContent: data.partialContent ?? stream.partialContent,
      partialTrace: data.partialTrace === undefined ? stream.partialTrace : data.partialTrace,
      lastActivityAt: data.lastActivityAt ?? stream.lastActivityAt,
      completedAt: data.completedAt ?? stream.completedAt,
    };
    this.activeStreams.set(id, updated);
    return updated;
  }

  async deleteActiveStream(id: string): Promise<void> {
    this.activeStreams.delete(id);
  }

  async findStaleActiveStreams(olderThan: Date): Promise<ActiveStreamRecord[]> {
    return [...this.activeStreams.values()].filter(
      (s) =>
        (s.status === 'active' || s.status === 'pending') &&
        s.lastActivityAt < olderThan,
    );
  }

  async deleteOldActiveStreams(before: Date): Promise<number> {
    let count = 0;
    for (const [id, stream] of this.activeStreams) {
      if (
        (stream.status === 'completed' || stream.status === 'failed' || stream.status === 'cancelled') &&
        stream.completedAt &&
        stream.completedAt < before
      ) {
        this.activeStreams.delete(id);
        count++;
      }
    }
    return count;
  }
}
