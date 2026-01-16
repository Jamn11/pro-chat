import {
  ActiveStreamRecord,
  AttachmentRecord,
  MessageRecord,
  MessageSource,
  ModelInfo,
  StreamStatus,
  ThreadRecord,
  ThreadSummary,
  ThinkingLevel,
  TraceEvent,
} from '../types';

export type SettingsRecord = {
  systemPrompt: string | null;
};

export type UserRecord = {
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
};

export type UpsertUserFromClerkInput = {
  clerkId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  imageUrl?: string;
};

export type CreateThreadInput = {
  userId: string;
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

export type CreateActiveStreamInput = {
  threadId: string;
  userMessageId: string;
  modelId: string;
  thinkingLevel?: ThinkingLevel | null;
};

export type UpdateActiveStreamInput = {
  assistantMessageId?: string | null;
  status?: StreamStatus;
  partialContent?: string;
  partialTrace?: TraceEvent[] | null;
  lastActivityAt?: Date;
  completedAt?: Date | null;
};

export interface ChatRepository {
  // User management (Clerk integration)
  findUserByClerkId(clerkId: string): Promise<UserRecord | null>;
  upsertUserFromClerk(input: UpsertUserFromClerkInput): Promise<UserRecord>;

  // Settings (per-user)
  getSettings(userId: string): Promise<SettingsRecord>;
  updateSettings(userId: string, systemPrompt: string | null): Promise<SettingsRecord>;

  // Models (shared across users)
  listModels(): Promise<ModelInfo[]>;
  upsertModels(models: ModelInfo[]): Promise<void>;

  // Threads (per-user)
  listThreads(userId: string): Promise<ThreadSummary[]>;
  createThread(input: CreateThreadInput): Promise<ThreadRecord>;
  updateThreadTitle(threadId: string, title: string): Promise<void>;
  deleteThread(threadId: string): Promise<void>;
  getThreadMessages(threadId: string): Promise<MessageRecord[]>;

  // Messages
  createMessage(input: CreateMessageInput): Promise<MessageRecord>;
  updateMessage(id: string, data: Partial<CreateMessageInput>): Promise<MessageRecord>;
  pruneMessageArtifacts(before: Date): Promise<number>;
  incrementThreadCost(threadId: string, delta: number): Promise<number>;

  // Attachments
  createAttachment(input: CreateAttachmentInput): Promise<AttachmentRecord>;
  attachAttachmentsToMessage(messageId: string, attachmentIds: string[]): Promise<void>;
  getAttachmentsByIds(ids: string[]): Promise<AttachmentRecord[]>;
  listAttachmentsForThread(threadId: string): Promise<AttachmentRecord[]>;

  // Memory tracking methods (per-user)
  getThreadsForMemoryExtraction(userId: string): Promise<ThreadSummary[]>;
  markThreadMemoryChecked(threadId: string): Promise<void>;

  // Active stream methods
  createActiveStream(input: CreateActiveStreamInput): Promise<ActiveStreamRecord>;
  getActiveStream(id: string): Promise<ActiveStreamRecord | null>;
  getActiveStreamByThread(threadId: string): Promise<ActiveStreamRecord | null>;
  updateActiveStream(id: string, data: UpdateActiveStreamInput): Promise<ActiveStreamRecord>;
  deleteActiveStream(id: string): Promise<void>;
  findStaleActiveStreams(olderThan: Date): Promise<ActiveStreamRecord[]>;
  deleteOldActiveStreams(before: Date): Promise<number>;
}
