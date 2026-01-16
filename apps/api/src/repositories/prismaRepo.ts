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
  SettingsRecord,
  UserRecord,
  UpsertUserFromClerkInput,
} from './types';

export class PrismaChatRepository implements ChatRepository {
  private prisma: PrismaClient;

  constructor(prismaClient?: PrismaClient) {
    this.prisma = prismaClient ?? new PrismaClient();
  }

  get client(): PrismaClient {
    return this.prisma;
  }

  // User management (Clerk integration)
  async findUserByClerkId(clerkId: string): Promise<UserRecord | null> {
    const user = await this.prisma.user.findUnique({
      where: { clerkId },
    });
    return user ? this.toUserRecord(user) : null;
  }

  async upsertUserFromClerk(input: UpsertUserFromClerkInput): Promise<UserRecord> {
    const user = await this.prisma.user.upsert({
      where: { clerkId: input.clerkId },
      update: {
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        imageUrl: input.imageUrl,
        lastSignInAt: new Date(),
      },
      create: {
        clerkId: input.clerkId,
        email: input.email,
        firstName: input.firstName,
        lastName: input.lastName,
        imageUrl: input.imageUrl,
        lastSignInAt: new Date(),
      },
    });
    return this.toUserRecord(user);
  }

  private toUserRecord(user: {
    id: string;
    clerkId: string;
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
      clerkId: user.clerkId,
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
    return { systemPrompt: user?.systemPrompt ?? null };
  }

  async updateSettings(userId: string, systemPrompt: string | null): Promise<SettingsRecord> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { systemPrompt },
    });
    return { systemPrompt: user.systemPrompt ?? null };
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
