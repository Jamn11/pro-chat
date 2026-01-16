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

export type Memory = {
  content: string;
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
