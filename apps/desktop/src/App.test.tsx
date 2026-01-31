import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App';

const createThread = vi.hoisted(
  () =>
    vi.fn(async () => ({
      id: 'thread-2',
      title: null,
      updatedAt: new Date().toISOString(),
      totalCost: 0,
    })),
);
const streamChat = vi.hoisted(() => vi.fn(async (_payload: unknown, _callbacks?: unknown) => {}));

vi.mock('./api', () => ({
  fetchModels: vi.fn(async () => [
    {
      id: 'anthropic/claude-sonnet-4.5',
      label: 'Anthropic: Claude Sonnet 4.5',
      supportsVision: false,
      supportsThinkingLevels: true,
    },
    {
      id: 'openai/gpt-5.2',
      label: 'OpenAI: GPT-5.2',
      supportsVision: false,
      supportsThinkingLevels: true,
    },
    {
      id: 'openai/o3',
      label: 'OpenAI: o3',
      supportsVision: false,
      supportsThinkingLevels: true,
    },
  ]),
  fetchThreads: vi.fn(async () => [
    {
      id: 'thread-1',
      title: 'Test thread',
      updatedAt: new Date().toISOString(),
      totalCost: 0,
    },
  ]),
  fetchSettings: vi.fn(async () => ({ systemPrompt: '', openRouterApiKey: null, braveSearchApiKey: null })),
  fetchUsageStats: vi.fn(async () => ({
    totalCost: 0,
    totalMessages: 0,
    totalThreads: 0,
    costByModel: {},
    messagesByModel: {},
    dailyStats: [],
  })),
  fetchMemory: vi.fn(async () => ({ content: '' })),
  fetchMessages: vi.fn(async () => []),
  createThread,
  deleteThread: vi.fn(async () => {}),
  updateSettings: vi.fn(async () => ({ systemPrompt: '', openRouterApiKey: null, braveSearchApiKey: null })),
  updateMemory: vi.fn(async () => ({ content: '' })),
  checkActiveStream: vi.fn(async () => ({ hasActiveStream: false, stream: null })),
  resumeStream: vi.fn(async () => {}),
  cancelActiveStream: vi.fn(async () => ({ cancelled: true })),
  triggerMemoryExtraction: vi.fn(async () => ({ processed: 0, memoriesAdded: 0, skipped: 0, errors: 0 })),
  uploadFiles: vi.fn(async () => []),
  streamChat,
}));

describe('App', () => {
  afterEach(() => {
    cleanup();
  });
  it('renders threads and model selector', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('pro-chat')).toBeTruthy();
      expect(screen.getAllByText('Test thread').length).toBeGreaterThan(0);
    });

    expect(screen.getByRole('button', { name: /new chat/i })).toBeTruthy();
    expect(screen.getByRole('option', { name: /openai: o3/i })).toBeTruthy();
    expect(screen.getByRole('option', { name: /anthropic: claude sonnet 4.5/i })).toBeTruthy();
  });

  it('shows Claude thinking budgets', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText('Thinking selector')).toBeTruthy();
    });

    expect(screen.getByRole('option', { name: /thinking: off/i })).toBeTruthy();
    expect(screen.getByRole('option', { name: /thinking: low .*8k/i })).toBeTruthy();
    expect(screen.getByRole('option', { name: /thinking: medium .*16k/i })).toBeTruthy();
    expect(screen.getByRole('option', { name: /thinking: high .*32k/i })).toBeTruthy();
  });

  it('supports slash command model switching', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText('Model selector')).toBeTruthy();
    });

    const input = screen.getByPlaceholderText('Type your message...');
    await user.type(input, '/o3');
    await user.keyboard('{Enter}');

    const modelSelect = screen.getByLabelText('Model selector') as HTMLSelectElement;
    expect(modelSelect.value).toBe('openai/o3');
    expect((input as HTMLTextAreaElement).value).toBe('');
  });

  it('supports slash command thinking selection', async () => {
    const user = userEvent.setup();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText('Thinking selector')).toBeTruthy();
    });

    const input = screen.getByPlaceholderText('Type your message...');
    await user.type(input, '/thinking low');
    await user.keyboard('{Enter}');

    const thinkingSelect = screen.getByLabelText('Thinking selector') as HTMLSelectElement;
    expect(thinkingSelect.value).toBe('low');
    expect((input as HTMLTextAreaElement).value).toBe('');
  });

  it('creates a new chat with cmd+shift+o', async () => {
    createThread.mockClear();
    render(<App />);

    await waitFor(() => {
      expect(screen.getAllByText('Test thread').length).toBeGreaterThan(0);
    });

    fireEvent.keyDown(window, { key: 'O', metaKey: true, shiftKey: true });
    expect(createThread).not.toHaveBeenCalled();
    expect(screen.getByText('New chat')).toBeTruthy();
  });

  it('keeps messages visible after starting a new chat and sending', async () => {
    const user = userEvent.setup();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    streamChat.mockImplementationOnce(async (_payload: unknown, callbacks: any) => {
      callbacks?.onDone?.({
        userMessage: {
          id: 'user-1',
          role: 'user',
          content: 'Hello there',
          modelId: 'openai/o3',
          thinkingLevel: null,
          createdAt: new Date().toISOString(),
          attachments: [],
        },
        assistantMessage: {
          id: 'assistant-1',
          role: 'assistant',
          content: 'Hi!',
          modelId: 'openai/o3',
          thinkingLevel: null,
          createdAt: new Date().toISOString(),
          durationMs: 0,
          cost: 0,
        },
        totalCost: 0,
        durationMs: 0,
      });
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new chat/i })).toBeTruthy();
    });

    await user.click(screen.getByRole('button', { name: /new chat/i }));
    const input = screen.getByPlaceholderText('Type your message...');
    await user.type(input, 'Hello there');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(screen.getAllByText('Hello there').length).toBeGreaterThan(0);
    });
  });
});
