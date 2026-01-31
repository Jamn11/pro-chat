import { PrismaClient } from '@prisma/client';
import {
  ActiveStreamRecord,
  AttachmentRecord,
  AttachmentKind,
  ChatRole,
  MessageRecord,
  MessageSource,
  ModelInfo,
  StreamStatus,
  ThinkingLevel,
  ThreadRecord,
  ThreadSummary,
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
  UpdateActiveStreamInput,
  UsageRecord,
  UsageStats,
} from './types';

export class PrismaChatRepository implements ChatRepository {
  private prisma: PrismaClient;
  // Store usage records in memory (persists across chat deletions within session)
  private usageRecords: UsageRecord[] = [];

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? new PrismaClient();
  }

  get client(): PrismaClient {
    return this.prisma;
  }

  // User management (local desktop)
  async getOrCreateLocalUser(localUserKey: string): Promise<UserRecord> {
    const existing = await this.prisma.user.findUnique({
      where: { localUserKey },
    });
    if (existing) return this.toUserRecord(existing);

    const fallback = await this.prisma.user.findFirst({
      orderBy: { updatedAt: 'desc' },
    });
    if (fallback) return this.toUserRecord(fallback);

    const user = await this.prisma.user.create({
      data: {
        localUserKey,
        lastSignInAt: new Date(),
      },
    });
    return this.toUserRecord(user);
  }

  private toUserRecord(user: {
    id: string;
    localUserKey: string | null;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    imageUrl: string | null;
    systemPrompt: string | null;
    createdAt: Date;
    updatedAt: Date;
    lastSignInAt: Date | null;
  }): UserRecord {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      imageUrl: user.imageUrl,
      systemPrompt: user.systemPrompt,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      lastSignInAt: user.lastSignInAt,
    };
  }

  // Settings (per-user)
  async getSettings(userId: string): Promise<SettingsRecord> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    return {
      systemPrompt: user?.systemPrompt ?? null,
      openRouterApiKey: user?.openRouterApiKey ?? null,
      braveSearchApiKey: user?.braveSearchApiKey ?? null,
      defaultModelId: user?.defaultModelId ?? null,
      defaultThinkingLevel: user?.defaultThinkingLevel ?? null,
      enabledModelIds: parseStringArray(user?.enabledModelIds, []),
      enabledTools: parseStringArray(user?.enabledTools, ['web_search', 'code_interpreter', 'memory']),
      hideCostPerMessage: user?.hideCostPerMessage ?? false,
      fontFamily: user?.fontFamily ?? 'Space Mono',
      fontSize: user?.fontSize ?? 'medium',
    };
  }

  async updateSettings(userId: string, settings: Partial<SettingsRecord>): Promise<SettingsRecord> {
    // Build update data object with only defined fields
    const updateData: Record<string, unknown> = {};
    if (settings.systemPrompt !== undefined) updateData.systemPrompt = settings.systemPrompt;
    if (settings.openRouterApiKey !== undefined) updateData.openRouterApiKey = settings.openRouterApiKey;
    if (settings.braveSearchApiKey !== undefined) updateData.braveSearchApiKey = settings.braveSearchApiKey;
    if (settings.defaultModelId !== undefined) updateData.defaultModelId = settings.defaultModelId;
    if (settings.defaultThinkingLevel !== undefined) updateData.defaultThinkingLevel = settings.defaultThinkingLevel;
    if (settings.enabledModelIds !== undefined) {
      updateData.enabledModelIds = serializeJson(settings.enabledModelIds);
    }
    if (settings.enabledTools !== undefined) {
      updateData.enabledTools = serializeJson(settings.enabledTools);
    }
    if (settings.hideCostPerMessage !== undefined) updateData.hideCostPerMessage = settings.hideCostPerMessage;
    if (settings.fontFamily !== undefined) updateData.fontFamily = settings.fontFamily;
    if (settings.fontSize !== undefined) updateData.fontSize = settings.fontSize;

    if (Object.keys(updateData).length > 0) {
      await this.prisma.user.update({
        where: { id: userId },
        data: updateData,
      });
    }

    return this.getSettings(userId);
  }

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

  async listThreads(userId: string): Promise<ThreadSummary[]> {
    const threads = await this.prisma.chatThread.findMany({
      where: { userId },
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
    const thread = await this.prisma.chatThread.create({
      data: { title: input.title ?? null, userId: input.userId },
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
      role: parseChatRole(message.role),
      content: message.content,
      modelId: message.modelId,
      thinkingLevel: parseThinkingLevel(message.thinkingLevel),
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
        kind: parseAttachmentKind(attachment.kind),
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
        trace: serializeJsonOrNull(input.trace),
        sources: serializeJsonOrNull(input.sources),
      },
    });
    return {
      id: message.id,
      threadId: message.threadId,
      role: parseChatRole(message.role),
      content: message.content,
      modelId: message.modelId,
      thinkingLevel: parseThinkingLevel(message.thinkingLevel),
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
        trace: data.trace === undefined ? undefined : serializeJsonOrNull(data.trace),
        sources: data.sources === undefined ? undefined : serializeJsonOrNull(data.sources),
      },
    });
    return {
      id: message.id,
      threadId: message.threadId,
      role: parseChatRole(message.role),
      content: message.content,
      modelId: message.modelId,
      thinkingLevel: parseThinkingLevel(message.thinkingLevel),
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
      data: { trace: null, sources: null },
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
      kind: parseAttachmentKind(attachment.kind),
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
      kind: parseAttachmentKind(attachment.kind),
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
      kind: parseAttachmentKind(attachment.kind),
      createdAt: attachment.createdAt,
    }));
  }

  async getThreadsForMemoryExtraction(userId: string): Promise<ThreadSummary[]> {
    // Get threads that have messages and either:
    // - Haven't been memory-checked yet (memoryCheckedAt is null)
    // - Were updated after the last memory check
    const threads = await this.prisma.chatThread.findMany({
      where: {
        userId,
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

  // Active stream methods

  async createActiveStream(input: CreateActiveStreamInput): Promise<ActiveStreamRecord> {
    const stream = await this.prisma.activeStream.create({
      data: {
        threadId: input.threadId,
        userMessageId: input.userMessageId,
        modelId: input.modelId,
        thinkingLevel: input.thinkingLevel ?? null,
      },
    });
    return {
      id: stream.id,
      threadId: stream.threadId,
      userMessageId: stream.userMessageId,
      assistantMessageId: stream.assistantMessageId,
      status: parseStreamStatus(stream.status),
      partialContent: stream.partialContent,
      partialTrace: parseTrace(stream.partialTrace),
      modelId: stream.modelId,
      thinkingLevel: parseThinkingLevel(stream.thinkingLevel),
      startedAt: stream.startedAt,
      lastActivityAt: stream.lastActivityAt,
      completedAt: stream.completedAt,
    };
  }

  async getActiveStream(id: string): Promise<ActiveStreamRecord | null> {
    const stream = await this.prisma.activeStream.findUnique({
      where: { id },
    });
    if (!stream) return null;
    return {
      id: stream.id,
      threadId: stream.threadId,
      userMessageId: stream.userMessageId,
      assistantMessageId: stream.assistantMessageId,
      status: parseStreamStatus(stream.status),
      partialContent: stream.partialContent,
      partialTrace: parseTrace(stream.partialTrace),
      modelId: stream.modelId,
      thinkingLevel: parseThinkingLevel(stream.thinkingLevel),
      startedAt: stream.startedAt,
      lastActivityAt: stream.lastActivityAt,
      completedAt: stream.completedAt,
    };
  }

  async getActiveStreamByThread(threadId: string): Promise<ActiveStreamRecord | null> {
    const stream = await this.prisma.activeStream.findFirst({
      where: {
        threadId,
        status: { in: ['active', 'pending'] },
      },
      orderBy: { startedAt: 'desc' },
    });
    if (!stream) return null;
    return {
      id: stream.id,
      threadId: stream.threadId,
      userMessageId: stream.userMessageId,
      assistantMessageId: stream.assistantMessageId,
      status: parseStreamStatus(stream.status),
      partialContent: stream.partialContent,
      partialTrace: parseTrace(stream.partialTrace),
      modelId: stream.modelId,
      thinkingLevel: parseThinkingLevel(stream.thinkingLevel),
      startedAt: stream.startedAt,
      lastActivityAt: stream.lastActivityAt,
      completedAt: stream.completedAt,
    };
  }

  async updateActiveStream(id: string, data: UpdateActiveStreamInput): Promise<ActiveStreamRecord> {
    const stream = await this.prisma.activeStream.update({
      where: { id },
      data: {
        assistantMessageId: data.assistantMessageId ?? undefined,
        status: data.status ?? undefined,
        partialContent: data.partialContent ?? undefined,
        partialTrace: data.partialTrace === undefined ? undefined : serializeJsonOrNull(data.partialTrace),
        lastActivityAt: data.lastActivityAt ?? undefined,
        completedAt: data.completedAt ?? undefined,
      },
    });
    return {
      id: stream.id,
      threadId: stream.threadId,
      userMessageId: stream.userMessageId,
      assistantMessageId: stream.assistantMessageId,
      status: parseStreamStatus(stream.status),
      partialContent: stream.partialContent,
      partialTrace: parseTrace(stream.partialTrace),
      modelId: stream.modelId,
      thinkingLevel: parseThinkingLevel(stream.thinkingLevel),
      startedAt: stream.startedAt,
      lastActivityAt: stream.lastActivityAt,
      completedAt: stream.completedAt,
    };
  }

  async deleteActiveStream(id: string): Promise<void> {
    await this.prisma.activeStream.delete({
      where: { id },
    });
  }

  async findStaleActiveStreams(olderThan: Date): Promise<ActiveStreamRecord[]> {
    const streams = await this.prisma.activeStream.findMany({
      where: {
        status: { in: ['active', 'pending'] },
        lastActivityAt: { lt: olderThan },
      },
    });
    return streams.map((stream) => ({
      id: stream.id,
      threadId: stream.threadId,
      userMessageId: stream.userMessageId,
      assistantMessageId: stream.assistantMessageId,
      status: parseStreamStatus(stream.status),
      partialContent: stream.partialContent,
      partialTrace: parseTrace(stream.partialTrace),
      modelId: stream.modelId,
      thinkingLevel: parseThinkingLevel(stream.thinkingLevel),
      startedAt: stream.startedAt,
      lastActivityAt: stream.lastActivityAt,
      completedAt: stream.completedAt,
    }));
  }

  async deleteOldActiveStreams(before: Date): Promise<number> {
    const result = await this.prisma.activeStream.deleteMany({
      where: {
        status: { in: ['completed', 'failed', 'cancelled'] },
        completedAt: { lt: before },
      },
    });
    return result.count;
  }
}

const parseTrace = (value: unknown): TraceEvent[] | null => parseJsonArray<TraceEvent>(value);

const parseSources = (value: unknown): MessageSource[] | null => parseJsonArray<MessageSource>(value);

const parseStringArray = (value: unknown, fallback: string[]): string[] => {
  const parsed = parseJsonArray<string>(value);
  return parsed ?? fallback;
};

const parseChatRole = (value: string): ChatRole => (isChatRole(value) ? value : 'user');

const parseThinkingLevel = (value: string | null): ThinkingLevel | null =>
  value && isThinkingLevel(value) ? value : null;

const parseAttachmentKind = (value: string): AttachmentKind => (isAttachmentKind(value) ? value : 'file');

const parseStreamStatus = (value: string): StreamStatus => (isStreamStatus(value) ? value : 'failed');

const isChatRole = (value: string): value is ChatRole =>
  value === 'user' || value === 'assistant' || value === 'system';

const isThinkingLevel = (value: string): value is ThinkingLevel =>
  value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh';

const isAttachmentKind = (value: string): value is AttachmentKind => value === 'image' || value === 'file';

const isStreamStatus = (value: string): value is StreamStatus =>
  value === 'active' ||
  value === 'pending' ||
  value === 'completed' ||
  value === 'failed' ||
  value === 'cancelled';

const parseJsonArray = <T>(value: unknown): T[] | null => {
  if (!value) return null;
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : null;
    } catch {
      return null;
    }
  }
  return null;
};

const serializeJson = (value: unknown): string => JSON.stringify(value);

const serializeJsonOrNull = (value: unknown): string | null => {
  if (value === null || value === undefined) return null;
  return JSON.stringify(value);
};
