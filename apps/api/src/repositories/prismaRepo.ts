import { Prisma, PrismaClient } from '@prisma/client';
import {
  AttachmentRecord,
  MessageRecord,
  MessageSource,
  ModelInfo,
  ThreadRecord,
  ThreadSummary,
  TraceEvent,
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

export class PrismaChatRepository implements ChatRepository {
  private prisma: PrismaClient;
  private defaultUserId: string | null = null;
  // Store additional settings in memory (systemPrompt goes to DB)
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
  // Store usage records in memory (persists across chat deletions within session)
  private usageRecords: UsageRecord[] = [];

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? new PrismaClient();
  }

  get client(): PrismaClient {
    return this.prisma;
  }

  async ensureDefaultUser(): Promise<string> {
    if (this.defaultUserId) return this.defaultUserId;
    const existing = await this.prisma.user.findFirst();
    if (existing) {
      this.defaultUserId = existing.id;
      return existing.id;
    }
    const created = await this.prisma.user.create({ data: {} });
    this.defaultUserId = created.id;
    return created.id;
  }

  async getSettings(): Promise<SettingsRecord> {
    const userId = await this.ensureDefaultUser();
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return {
      systemPrompt: user?.systemPrompt ?? null,
      ...this.additionalSettings,
    };
  }

  async updateSettings(settings: Partial<SettingsRecord>): Promise<SettingsRecord> {
    const userId = await this.ensureDefaultUser();

    // Update systemPrompt in DB if provided
    if (settings.systemPrompt !== undefined) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { systemPrompt: settings.systemPrompt },
      });
    }

    // Update additional settings in memory
    const { systemPrompt, ...rest } = settings;
    this.additionalSettings = { ...this.additionalSettings, ...rest };

    return this.getSettings();
  }

  async getUsageStats(): Promise<UsageStats> {
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

    // Also include historical data from existing messages (for backward compatibility)
    const messages = await this.prisma.message.findMany({
      select: {
        modelId: true,
        cost: true,
        createdAt: true,
      },
    });

    for (const message of messages) {
      if (message.modelId && message.cost) {
        totalCost += message.cost;
        costByModel[message.modelId] = (costByModel[message.modelId] || 0) + message.cost;
        messagesByModel[message.modelId] = (messagesByModel[message.modelId] || 0) + 1;
        const date = message.createdAt.toISOString().split('T')[0];
        const existing = statsByDate.get(date) || { cost: 0, messages: 0 };
        statsByDate.set(date, {
          cost: existing.cost + message.cost,
          messages: existing.messages + 1,
        });
      }
    }

    const threads = await this.prisma.chatThread.findMany({
      select: { id: true },
    });

    const dailyStats: Array<{ date: string; cost: number; messages: number }> = [];
    for (const [date, stats] of statsByDate) {
      dailyStats.push({ date, ...stats });
    }
    dailyStats.sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalCost,
      totalMessages: this.usageRecords.length + messages.length,
      totalThreads: threads.length,
      costByModel,
      messagesByModel,
      dailyStats,
    };
  }

  async createUsageRecord(input: CreateUsageRecordInput): Promise<UsageRecord> {
    const record: UsageRecord = {
      id: `usage-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
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
    const models = await this.prisma.model.findMany({
      where: { isActive: true },
      orderBy: { label: 'asc' },
    });
    return models.map((model) => ({
      id: model.id,
      label: model.label,
      inputCostPerToken: model.inputCostPerToken,
      outputCostPerToken: model.outputCostPerToken,
      supportsVision: model.supportsVision,
      supportsThinkingLevels: model.supportsThinkingLevels,
    }));
  }

  async upsertModels(models: ModelInfo[]): Promise<void> {
    await this.prisma.$transaction(
      models.map((model) =>
        this.prisma.model.upsert({
          where: { id: model.id },
          update: {
            label: model.label,
            inputCostPerToken: model.inputCostPerToken,
            outputCostPerToken: model.outputCostPerToken,
            supportsVision: model.supportsVision,
            supportsThinkingLevels: model.supportsThinkingLevels,
            isActive: true,
          },
          create: {
            id: model.id,
            label: model.label,
            inputCostPerToken: model.inputCostPerToken,
            outputCostPerToken: model.outputCostPerToken,
            supportsVision: model.supportsVision,
            supportsThinkingLevels: model.supportsThinkingLevels,
            isActive: true,
          },
        }),
      ),
    );
  }

  async listThreads(): Promise<ThreadSummary[]> {
    await this.ensureDefaultUser();
    const threads = await this.prisma.chatThread.findMany({
      orderBy: { updatedAt: 'desc' },
    });
    return threads.map((thread) => ({
      id: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      totalCost: thread.totalCost,
      memoryCheckedAt: thread.memoryCheckedAt,
    }));
  }

  async createThread(input: CreateThreadInput): Promise<ThreadRecord> {
    const userId = await this.ensureDefaultUser();
    const thread = await this.prisma.chatThread.create({
      data: { title: input.title ?? null, userId },
    });
    return {
      id: thread.id,
      title: thread.title,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      totalCost: thread.totalCost,
      memoryCheckedAt: thread.memoryCheckedAt,
    };
  }

  async updateThreadTitle(threadId: string, title: string): Promise<void> {
    await this.prisma.chatThread.update({
      where: { id: threadId },
      data: { title },
    });
  }

  async deleteThread(threadId: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.attachment.deleteMany({ where: { threadId } }),
      this.prisma.message.deleteMany({ where: { threadId } }),
      this.prisma.chatThread.delete({ where: { id: threadId } }),
    ]);
  }

  async getThreadMessages(threadId: string): Promise<MessageRecord[]> {
    const messages = await this.prisma.message.findMany({
      where: { threadId },
      include: { attachments: true },
      orderBy: { createdAt: 'asc' },
    });
    return messages.map((message) => ({
      id: message.id,
      threadId: message.threadId,
      role: message.role,
      content: message.content,
      modelId: message.modelId,
      thinkingLevel: message.thinkingLevel,
      createdAt: message.createdAt,
      durationMs: message.durationMs,
      promptTokens: message.promptTokens,
      completionTokens: message.completionTokens,
      cost: message.cost,
      trace: parseTrace(message.trace),
      sources: parseSources(message.sources),
      attachments: message.attachments.map((attachment) => ({
        id: attachment.id,
        threadId: attachment.threadId,
        messageId: attachment.messageId,
        filename: attachment.filename,
        path: attachment.path,
        mimeType: attachment.mimeType,
        size: attachment.size,
        kind: attachment.kind,
        createdAt: attachment.createdAt,
      })),
    }));
  }

  async createMessage(input: CreateMessageInput): Promise<MessageRecord> {
    const message = await this.prisma.message.create({
      data: {
        threadId: input.threadId,
        role: input.role,
        content: input.content,
        modelId: input.modelId ?? null,
        thinkingLevel: input.thinkingLevel ?? null,
        durationMs: input.durationMs ?? null,
        promptTokens: input.promptTokens ?? null,
        completionTokens: input.completionTokens ?? null,
        cost: input.cost ?? 0,
        trace: input.trace ?? undefined,
        sources: input.sources ?? undefined,
      },
    });
    return {
      id: message.id,
      threadId: message.threadId,
      role: message.role,
      content: message.content,
      modelId: message.modelId,
      thinkingLevel: message.thinkingLevel,
      createdAt: message.createdAt,
      durationMs: message.durationMs,
      promptTokens: message.promptTokens,
      completionTokens: message.completionTokens,
      cost: message.cost,
      trace: parseTrace(message.trace),
      sources: parseSources(message.sources),
    };
  }

  async updateMessage(id: string, data: Partial<CreateMessageInput>): Promise<MessageRecord> {
    const message = await this.prisma.message.update({
      where: { id },
      data: {
        content: data.content,
        modelId: data.modelId ?? undefined,
        thinkingLevel: data.thinkingLevel ?? undefined,
        durationMs: data.durationMs ?? undefined,
        promptTokens: data.promptTokens ?? undefined,
        completionTokens: data.completionTokens ?? undefined,
        cost: data.cost ?? undefined,
        trace: data.trace === undefined ? undefined : data.trace ?? Prisma.DbNull,
        sources: data.sources === undefined ? undefined : data.sources ?? Prisma.DbNull,
      },
    });
    return {
      id: message.id,
      threadId: message.threadId,
      role: message.role,
      content: message.content,
      modelId: message.modelId,
      thinkingLevel: message.thinkingLevel,
      createdAt: message.createdAt,
      durationMs: message.durationMs,
      promptTokens: message.promptTokens,
      completionTokens: message.completionTokens,
      cost: message.cost,
      trace: parseTrace(message.trace),
      sources: parseSources(message.sources),
    };
  }

  async pruneMessageArtifacts(before: Date): Promise<number> {
    const result = await this.prisma.message.updateMany({
      where: { createdAt: { lt: before } },
      data: { trace: Prisma.DbNull, sources: Prisma.DbNull },
    });
    return result.count;
  }

  async incrementThreadCost(threadId: string, delta: number): Promise<number> {
    const thread = await this.prisma.chatThread.update({
      where: { id: threadId },
      data: { totalCost: { increment: delta } },
    });
    return thread.totalCost;
  }

  async createAttachment(input: CreateAttachmentInput): Promise<AttachmentRecord> {
    const attachment = await this.prisma.attachment.create({
      data: {
        threadId: input.threadId,
        filename: input.filename,
        path: input.path,
        mimeType: input.mimeType,
        size: input.size,
        kind: input.kind,
      },
    });
    return {
      id: attachment.id,
      threadId: attachment.threadId,
      messageId: attachment.messageId,
      filename: attachment.filename,
      path: attachment.path,
      mimeType: attachment.mimeType,
      size: attachment.size,
      kind: attachment.kind,
      createdAt: attachment.createdAt,
    };
  }

  async attachAttachmentsToMessage(messageId: string, attachmentIds: string[]): Promise<void> {
    if (attachmentIds.length === 0) return;
    await this.prisma.attachment.updateMany({
      where: { id: { in: attachmentIds } },
      data: { messageId },
    });
  }

  async getAttachmentsByIds(ids: string[]): Promise<AttachmentRecord[]> {
    if (ids.length === 0) return [];
    const attachments = await this.prisma.attachment.findMany({
      where: { id: { in: ids } },
    });
    return attachments.map((attachment) => ({
      id: attachment.id,
      threadId: attachment.threadId,
      messageId: attachment.messageId,
      filename: attachment.filename,
      path: attachment.path,
      mimeType: attachment.mimeType,
      size: attachment.size,
      kind: attachment.kind,
      createdAt: attachment.createdAt,
    }));
  }

  async listAttachmentsForThread(threadId: string): Promise<AttachmentRecord[]> {
    const attachments = await this.prisma.attachment.findMany({
      where: { threadId },
    });
    return attachments.map((attachment) => ({
      id: attachment.id,
      threadId: attachment.threadId,
      messageId: attachment.messageId,
      filename: attachment.filename,
      path: attachment.path,
      mimeType: attachment.mimeType,
      size: attachment.size,
      kind: attachment.kind,
      createdAt: attachment.createdAt,
    }));
  }

  async getThreadsForMemoryExtraction(): Promise<ThreadSummary[]> {
    await this.ensureDefaultUser();
    // Get threads that have messages and either:
    // - Haven't been memory-checked yet (memoryCheckedAt is null)
    // - Were updated after the last memory check
    const threads = await this.prisma.chatThread.findMany({
      where: {
        messages: {
          some: {},
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    // Filter threads that need memory extraction:
    // Either never checked, or updated after the last check
    const needsExtraction = threads.filter((thread) => {
      if (!thread.memoryCheckedAt) return true;
      return thread.updatedAt > thread.memoryCheckedAt;
    });
    return needsExtraction.map((thread) => ({
      id: thread.id,
      title: thread.title,
      updatedAt: thread.updatedAt,
      totalCost: thread.totalCost,
      memoryCheckedAt: thread.memoryCheckedAt,
    }));
  }

  async markThreadMemoryChecked(threadId: string): Promise<void> {
    await this.prisma.chatThread.update({
      where: { id: threadId },
      data: { memoryCheckedAt: new Date() },
    });
  }
}

const parseTrace = (value: unknown): TraceEvent[] | null => {
  if (!value) return null;
  if (Array.isArray(value)) return value as TraceEvent[];
  return null;
};

const parseSources = (value: unknown): MessageSource[] | null => {
  if (!value) return null;
  if (Array.isArray(value)) return value as MessageSource[];
  return null;
};
