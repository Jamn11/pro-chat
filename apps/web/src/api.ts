import type { Message, ModelInfo, Settings, ThreadSummary, UploadAttachment } from './types';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function handleJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Request failed');
  }
  return response.json() as Promise<T>;
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await fetch('/api/models');
  const data = await handleJson<{ models: ModelInfo[] }>(res);
  return data.models;
}

export async function fetchThreads(): Promise<ThreadSummary[]> {
  const res = await fetch('/api/threads');
  const data = await handleJson<{ threads: ThreadSummary[] }>(res);
  return data.threads;
}

export async function createThread(title?: string | null): Promise<ThreadSummary> {
  const res = await fetch('/api/threads', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ title }),
  });
  return handleJson<ThreadSummary>(res);
}

export async function deleteThread(threadId: string): Promise<void> {
  const res = await fetch(`/api/threads/${threadId}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Delete failed');
  }
}

export async function fetchMessages(threadId: string): Promise<Message[]> {
  const res = await fetch(`/api/threads/${threadId}/messages`);
  const data = await handleJson<{ messages: Message[] }>(res);
  return data.messages;
}

export async function fetchSettings(): Promise<Settings> {
  const res = await fetch('/api/settings');
  return handleJson<Settings>(res);
}

export async function updateSettings(systemPrompt: string | null): Promise<Settings> {
  const res = await fetch('/api/settings', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ systemPrompt }),
  });
  return handleJson<Settings>(res);
}

export async function uploadFiles(threadId: string, files: FileList): Promise<UploadAttachment[]> {
  const formData = new FormData();
  formData.append('threadId', threadId);
  Array.from(files).forEach((file) => {
    formData.append('files', file);
  });

  const res = await fetch('/api/uploads', {
    method: 'POST',
    body: formData,
  });

  const data = await handleJson<{ attachments: UploadAttachment[] }>(res);
  return data.attachments;
}

export type StreamCallbacks = {
  onMeta?: (data: { threadId: string; modelId: string }) => void;
  onDelta?: (delta: string) => void;
  onDone?: (data: {
    userMessage: Message;
    assistantMessage: Message;
    totalCost: number;
    promptTokens?: number;
    completionTokens?: number;
    durationMs: number;
  }) => void;
  onError?: (message: string) => void;
};

export async function streamChat(
  payload: {
    threadId: string;
    content: string;
    modelId: string;
    thinkingLevel?: string | null;
    attachmentIds?: string[];
  },
  callbacks: StreamCallbacks,
) {
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || 'Stream failed');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  let done = false;
  while (!done) {
    const { value, done: readerDone } = await reader.read();
    done = readerDone;
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const lines = chunk.split('\n');
      let event = 'message';
      let data = '';
      for (const line of lines) {
        if (line.startsWith('event:')) {
          event = line.replace('event:', '').trim();
        } else if (line.startsWith('data:')) {
          data += line.replace('data:', '').trim();
        }
      }

      if (data) {
        const parsed = JSON.parse(data);
        if (event === 'meta') callbacks.onMeta?.(parsed);
        if (event === 'delta') callbacks.onDelta?.(parsed.content);
        if (event === 'done') callbacks.onDone?.(parsed);
        if (event === 'error') callbacks.onError?.(parsed.message);
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}
