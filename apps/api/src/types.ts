export type ThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh';

export type ChatRole = 'user' | 'assistant' | 'system';

export type AttachmentKind = 'image' | 'file';

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
};

export type ThreadSummary = {
  id: string;
  title: string | null;
  updatedAt: Date;
  totalCost: number;
};

export type ThreadRecord = ThreadSummary & {
  createdAt: Date;
};
