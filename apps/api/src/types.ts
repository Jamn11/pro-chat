export type ThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh';

export type ChatRole = 'user' | 'assistant' | 'system';

export type AttachmentKind = 'image' | 'file';

export type StreamStatus = 'active' | 'pending' | 'completed' | 'failed' | 'cancelled';

export type ModelInfo = {
  id: string;
  label: string;
  inputCostPerToken: number;
  outputCostPerToken: number;
  supportsVision: boolean;
  supportsThinkingLevels: boolean;
};

export type AttachmentRecord = {
  id: string;
  threadId: string;
  messageId: string | null;
  filename: string;
  path: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  createdAt: Date;
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

export type MessageRecord = {
  id: string;
  threadId: string;
  role: ChatRole;
  content: string;
  modelId: string | null;
  thinkingLevel: ThinkingLevel | null;
  createdAt: Date;
  durationMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  cost: number;
  attachments?: AttachmentRecord[];
  trace?: TraceEvent[] | null;
  sources?: MessageSource[] | null;
};

export type ThreadSummary = {
  id: string;
  title: string | null;
  updatedAt: Date;
  totalCost: number;
  memoryCheckedAt?: Date | null;
};

export type ThreadRecord = ThreadSummary & {
  createdAt: Date;
};

export type ActiveStreamRecord = {
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
