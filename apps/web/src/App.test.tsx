import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import App from './App';

vi.mock('./api', () => ({
  fetchModels: vi.fn(async () => [
    {
      id: 'x-ai/grok-4.1-fast',
      label: 'Grok 4.1 Fast',
      supportsVision: false,
      supportsThinkingLevels: false,
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
  createThread: vi.fn(async () => ({
    id: 'thread-2',
    title: null,
    updatedAt: new Date().toISOString(),
    totalCost: 0,
  })),
  deleteThread: vi.fn(async () => {}),
  updateSettings: vi.fn(async () => ({ systemPrompt: '' })),
  uploadFiles: vi.fn(async () => []),
  streamChat: vi.fn(async () => {}),
}));

describe('App', () => {
  it('renders threads and model selector', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('pro-chat')).toBeTruthy();
      expect(screen.getAllByText('Test thread').length).toBeGreaterThan(0);
    });

    expect(screen.getByRole('button', { name: /new chat/i })).toBeTruthy();
    expect(screen.getByRole('option', { name: /grok 4.1 fast/i })).toBeTruthy();
  });
});
