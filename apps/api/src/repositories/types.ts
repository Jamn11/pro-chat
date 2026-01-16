import {
  AttachmentRecord,
  MessageRecord,
  MessageSource,
  ModelInfo,
  ThreadRecord,
  ThreadSummary,
  ThinkingLevel,
  TraceEvent,
} from '../types';

export type SettingsRecord = {
  systemPrompt: string | null;
  defaultModelId: string | null;
  defaultThinkingLevel: string | null;
  enabledModelIds: string[];
  enabledTools: string[];
  hideCostPerMessage: boolean;
  notifications: boolean;
  fontFamily: string;
  fontSize: string;
};

export type UsageStats = {
  totalCost: number;
  totalMessages: number;
  totalThreads: number;
  costByModel: Record<string, number>;
  messagesByModel: Record<string, number>;
  dailyCosts: Array<{ date: string; cost: number }>;
};

export type UsageRecord = {
  id: string;
  modelId: string;
  cost: number;
  promptTokens: number;
  completionTokens: number;
  createdAt: Date;
};

export type CreateUsageRecordInput = {
  modelId: string;
  cost: number;
  promptTokens: number;
  completionTokens: number;
};

export type CreateThreadInput = {
  title?: string | null;
};

export type CreateMessageInput = {
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  modelId?: string | null;
  thinkingLevel?: ThinkingLevel | null;
  durationMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  cost?: number | null;
  trace?: TraceEvent[] | null;
  sources?: MessageSource[] | null;
};

export type CreateAttachmentInput = {
  threadId: string;
  filename: string;
  path: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'file';
};

export interface ChatRepository {
  ensureDefaultUser(): Promise<string>;
  getSettings(): Promise<SettingsRecord>;
  updateSettings(settings: Partial<SettingsRecord>): Promise<SettingsRecord>;
  getUsageStats(): Promise<UsageStats>;
  createUsageRecord(input: CreateUsageRecordInput): Promise<UsageRecord>;
  listModels(): Promise<ModelInfo[]>;
  upsertModels(models: ModelInfo[]): Promise<void>;
  listThreads(): Promise<ThreadSummary[]>;
  createThread(input: CreateThreadInput): Promise<ThreadRecord>;
  updateThreadTitle(threadId: string, title: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  getThreadMessages(threadId: string): Promise<MessageRecord[]>;
  createMessage(input: CreateMessageInput): Promise<MessageRecord>;
  updateMessage(id: string, data: Partial<CreateMessageInput>): Promise<MessageRecord>;
  pruneMessageArtifacts(before: Date): Promise<number>;
  incrementThreadCost(threadId: string, delta: number): Promise<number>;
  createAttachment(input: CreateAttachmentInput): Promise<AttachmentRecord>;
  attachAttachmentsToMessage(messageId: string, attachmentIds: string[]): Promise<void>;
  getAttachmentsByIds(ids: string[]): Promise<AttachmentRecord[]>;
  listAttachmentsForThread(threadId: string): Promise<AttachmentRecord[]>;
  // Memory tracking methods
  getThreadsForMemoryExtraction(): Promise<ThreadSummary[]>;
  markThreadMemoryChecked(threadId: string): Promise<void>;
}
