import type {
  CheckActiveStreamResponse,
  Memory,
  MemoryExtractionResult,
  Message,
  ModelInfo,
  Settings,
  ThreadSummary,
  TraceEvent,
  UploadAttachment,
} from './types';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

// Auth token getter - set by the app when ClerkProvider is ready
let getAuthToken: (() => Promise<string | null>) | null = null;

export function setAuthTokenGetter(getter: () => Promise<string | null>) {
  getAuthToken = getter;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  if (!getAuthToken) return {};
  const token = await getAuthToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      ...authHeaders,
    },
  });
}

async function handleJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || 'Request failed');
  }
  return response.json() as Promise<T>;
}

export async function fetchModels(): Promise<ModelInfo[]> {
  const res = await authFetch('/api/models');
  const data = await handleJson<{ models: ModelInfo[] }>(res);
  return data.models;
}

export async function fetchThreads(): Promise<ThreadSummary[]> {
  const res = await authFetch('/api/threads');
  const data = await handleJson<{ threads: ThreadSummary[] }>(res);
  return data.threads;
}

export async function createThread(title?: string | null): Promise<ThreadSummary> {
  const res = await authFetch('/api/threads', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ title }),
  });
  return handleJson<ThreadSummary>(res);
}

export async function deleteThread(threadId: string): Promise<void> {
  const res = await authFetch(`/api/threads/${threadId}`, { method: 'DELETE' });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || 'Delete failed');
  }
}

export async function fetchMessages(threadId: string): Promise<Message[]> {
  const res = await authFetch(`/api/threads/${threadId}/messages`);
  const data = await handleJson<{ messages: Message[] }>(res);
  return data.messages;
}

export async function fetchSettings(): Promise<Settings> {
  const res = await authFetch('/api/settings');
  return handleJson<Settings>(res);
}

export async function updateSettings(systemPrompt: string | null): Promise<Settings> {
  const res = await authFetch('/api/settings', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ systemPrompt }),
  });
  return handleJson<Settings>(res);
}

export async function fetchMemory(): Promise<Memory> {
  const res = await authFetch('/api/memory');
  return handleJson<Memory>(res);
}

export async function updateMemory(content: string): Promise<Memory> {
  const res = await authFetch('/api/memory', {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ content }),
  });
  return handleJson<Memory>(res);
}

export async function triggerMemoryExtraction(): Promise<MemoryExtractionResult> {
  const res = await authFetch('/api/memory/extract', {
    method: 'POST',
    headers: JSON_HEADERS,
  });
  return handleJson<MemoryExtractionResult>(res);
}

export async function uploadFiles(threadId: string, files: FileList): Promise<UploadAttachment[]> {
  const formData = new FormData();
  formData.append('threadId', threadId);
  Array.from(files).forEach((file) => {
    formData.append('files', file);
  });

  const authHeaders = await getAuthHeaders();
  const res = await fetch('/api/uploads', {
    method: 'POST',
    headers: authHeaders,
    body: formData,
  });

  const data = await handleJson<{ attachments: UploadAttachment[] }>(res);
  return data.attachments;
}

export type StreamCallbacks = {
  onMeta?: (data: { threadId: string; modelId: string }) => void;
  onStreamId?: (data: { streamId: string }) => void;
  onDelta?: (delta: string) => void;
  onTool?: (data: { name: string }) => void;
  onReasoning?: (data: { delta: string }) => void;
  onCatchup?: (data: {
    userMessageId: string;
    assistantMessageId: string | null;
    partialContent: string;
    partialTrace?: TraceEvent[] | null;
  }) => void;
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
    clientContext?: {
      iso: string;
      local: string;
      timeZone?: string;
      offsetMinutes?: number;
    };
    signal?: AbortSignal;
  },
  callbacks: StreamCallbacks,
) {
  const { signal, ...body } = payload;
  const authHeaders = await getAuthHeaders();
  const response = await fetch('/api/chat/stream', {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...authHeaders },
    body: JSON.stringify(body),
    signal,
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
        if (event === 'streamId') callbacks.onStreamId?.(parsed);
        if (event === 'delta') callbacks.onDelta?.(parsed.content);
        if (event === 'tool') callbacks.onTool?.(parsed);
        if (event === 'reasoning') callbacks.onReasoning?.(parsed);
        if (event === 'catchup') callbacks.onCatchup?.(parsed);
        if (event === 'done') callbacks.onDone?.(parsed);
        if (event === 'error') callbacks.onError?.(parsed.message);
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

export async function checkActiveStream(threadId: string): Promise<CheckActiveStreamResponse> {
  const res = await fetch(`/api/threads/${threadId}/active-stream`);
  return handleJson<CheckActiveStreamResponse>(res);
}

export async function resumeStream(
  streamId: string,
  callbacks: StreamCallbacks,
  signal?: AbortSignal,
) {
  const response = await fetch('/api/chat/resume', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ streamId }),
    signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(text || 'Resume stream failed');
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
        if (event === 'catchup') callbacks.onCatchup?.(parsed);
        if (event === 'delta') callbacks.onDelta?.(parsed.content);
        if (event === 'tool') callbacks.onTool?.(parsed);
        if (event === 'reasoning') callbacks.onReasoning?.(parsed);
        if (event === 'done') callbacks.onDone?.(parsed);
        if (event === 'error') callbacks.onError?.(parsed.message);
      }
      boundary = buffer.indexOf('\n\n');
    }
  }
}

export async function cancelActiveStream(streamId: string): Promise<void> {
  // We don't have a dedicated cancel endpoint yet, so this is a no-op
  // The stream will eventually timeout and be marked as failed
  console.log('Cancel stream requested:', streamId);
}
