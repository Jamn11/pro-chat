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

vi.mock('./api', () => ({
  fetchModels: vi.fn(async () => [
    {
      id: 'anthropic/claude-sonnet-4.5',
      label: 'Claude Sonnet 4.5',
      supportsVision: false,
      supportsThinkingLevels: true,
    },
    {
      id: 'openai/gpt-5.2',
      label: 'GPT-5.2',
      supportsVision: false,
      supportsThinkingLevels: true,
    },
    {
      id: 'x-ai/grok-4.1-fast',
      label: 'Grok 4.1 Fast',
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
  fetchSettings: vi.fn(async () => ({ systemPrompt: '' })),
  fetchMessages: vi.fn(async () => []),
  createThread,
  deleteThread: vi.fn(async () => {}),
  updateSettings: vi.fn(async () => ({ systemPrompt: '' })),
  uploadFiles: vi.fn(async () => []),
  streamChat: vi.fn(async () => {}),
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
    expect(screen.getByRole('option', { name: /grok 4.1 fast/i })).toBeTruthy();
    expect(screen.getByRole('option', { name: /claude sonnet 4.5/i })).toBeTruthy();
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
    await user.type(input, '/grok');
    await user.keyboard('{Enter}');

    const modelSelect = screen.getByLabelText('Model selector') as HTMLSelectElement;
    expect(modelSelect.value).toBe('x-ai/grok-4.1-fast');
    expect((input as HTMLTextAreaElement).value).toBe('');
  });

  it('creates a new chat with cmd+shift+o', async () => {
    const user = userEvent.setup();
    createThread.mockClear();
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('pro-chat')).toBeTruthy();
    });

    fireEvent.keyDown(window, { key: 'O', metaKey: true, shiftKey: true });
    expect(createThread).toHaveBeenCalled();
  });
});
