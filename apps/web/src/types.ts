export type ModelInfo = {
  id: string;
  label: string;
  supportsVision: boolean;
  supportsThinkingLevels: boolean;
};

export type ThreadSummary = {
  id: string;
  title: string | null;
  updatedAt: string;
  totalCost: number;
};

export type Attachment = {
  id: string;
  filename: string;
  url: string;
  mimeType: string;
  size: number;
  kind: 'image' | 'file';
  createdAt: string;
};

export type Message = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  modelId?: string | null;
  thinkingLevel?: string | null;
  createdAt: string;
  durationMs?: number | null;
  cost?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  attachments?: Attachment[];
  trace?: TraceEvent[] | null;
  sources?: MessageSource[] | null;
};

export type Settings = {
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
  dailyStats: Array<{ date: string; cost: number; messages: number }>;
};

export type TraceEvent = {
  id: string;
  type: 'reasoning' | 'tool';
  content: string;
  createdAt: string;
};

export type MessageSource = {
  id: string;
  kind: 'search' | 'web';
  title: string;
  url: string;
  snippet?: string;
  status?: number | null;
  contentType?: string | null;
  createdAt: string;
};

export type Memory = {
  content: string;
};

export type CreditsInfo = {
  credits: number;
};

export type MemoryExtractionResult = {
  processed: number;
  memoriesAdded: number;
  skipped: number;
  errors: number;
};

export type UploadAttachment = Attachment;

export type UIMessage = Message & {
  status?: 'streaming' | 'error' | 'done';
};

export type ActiveStreamInfo = {
  id: string;
  userMessageId: string;
  assistantMessageId: string | null;
  partialContent: string;
  partialTrace?: TraceEvent[] | null;
  status: 'active' | 'pending';
  startedAt: string;
  lastActivityAt: string;
};

export type CheckActiveStreamResponse = {
  hasActiveStream: boolean;
  stream?: ActiveStreamInfo;
};
