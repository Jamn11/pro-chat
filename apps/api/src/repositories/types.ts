import { AttachmentRecord, MessageRecord, ModelInfo, ThreadRecord, ThreadSummary } from '../types';

export type SettingsRecord = {
  systemPrompt: string | null;
};

export type CreateThreadInput = {
  title?: string | null;
};

export type CreateMessageInput = {
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  modelId?: string | null;
  thinkingLevel?: 'low' | 'medium' | 'high' | 'xhigh' | null;
  durationMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  cost?: number | null;
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
  updateSettings(systemPrompt: string | null): Promise<SettingsRecord>;
  listModels(): Promise<ModelInfo[]>;
  upsertModels(models: ModelInfo[]): Promise<void>;
  listThreads(): Promise<ThreadSummary[]>;
  createThread(input: CreateThreadInput): Promise<ThreadRecord>;
  updateThreadTitle(threadId: string, title: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  getThreadMessages(threadId: string): Promise<MessageRecord[]>;
  createMessage(input: CreateMessageInput): Promise<MessageRecord>;
  updateMessage(id: string, data: Partial<CreateMessageInput>): Promise<MessageRecord>;
  incrementThreadCost(threadId: string, delta: number): Promise<number>;
  createAttachment(input: CreateAttachmentInput): Promise<AttachmentRecord>;
  attachAttachmentsToMessage(messageId: string, attachmentIds: string[]): Promise<void>;
  getAttachmentsByIds(ids: string[]): Promise<AttachmentRecord[]>;
  listAttachmentsForThread(threadId: string): Promise<AttachmentRecord[]>;
}
