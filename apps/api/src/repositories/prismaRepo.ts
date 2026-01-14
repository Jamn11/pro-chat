import { PrismaClient } from '@prisma/client';
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

export class PrismaChatRepository implements ChatRepository {
  private prisma: PrismaClient;
  private defaultUserId: string | null = null;

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
    return { systemPrompt: user?.systemPrompt ?? null };
  }

  async updateSettings(systemPrompt: string | null): Promise<SettingsRecord> {
    const userId = await this.ensureDefaultUser();
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
    };
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
}
