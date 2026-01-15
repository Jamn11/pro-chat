import { describe, expect, it } from 'vitest';
import { InMemoryChatRepository } from '../src/repositories/inMemoryRepo';
import { ChatService } from '../src/services/chatService';
import { OpenRouterClient } from '../src/services/openrouter';
import { ModelInfo } from '../src/types';

class MockOpenRouterClient extends OpenRouterClient {
  constructor() {
    super({ apiKey: 'test' });
  }

  async streamChat(
    _input: Parameters<OpenRouterClient['streamChat']>[0],
    callbacks: Parameters<OpenRouterClient['streamChat']>[1] = {},
  ) {
    callbacks.onDelta?.('Hello');
    callbacks.onDelta?.(' world');
    return { content: 'Hello world', usage: { prompt_tokens: 10, completion_tokens: 5 } };
  }
}

describe('ChatService', () => {
  it('streams and stores assistant message with cost', async () => {
    const repo = new InMemoryChatRepository();
    const model: ModelInfo = {
      id: 'x-ai/grok-4.1-fast',
      label: 'Grok 4.1 Fast',
      inputCostPerToken: 0.0000002,
      outputCostPerToken: 0.0000005,
      supportsVision: false,
      supportsThinkingLevels: false,
    };
    await repo.upsertModels([model]);
    const thread = await repo.createThread({});

    const chatService = new ChatService(repo, new MockOpenRouterClient(), '/tmp');

    let streamed = '';
    const result = await chatService.sendMessageStream(
      {
        threadId: thread.id,
        content: 'Hi',
        modelId: model.id,
      },
      (chunk) => {
        streamed += chunk;
      },
    );

    expect(streamed).toBe('Hello world');
    expect(result.assistantMessage.content).toBe('Hello world');
    expect(result.totalCost).toBeGreaterThan(0);
  });

  it('rejects attachments from another thread', async () => {
    const repo = new InMemoryChatRepository();
    const model: ModelInfo = {
      id: 'x-ai/grok-4.1-fast',
      label: 'Grok 4.1 Fast',
      inputCostPerToken: 0.0000002,
      outputCostPerToken: 0.0000005,
      supportsVision: false,
      supportsThinkingLevels: false,
    };
    await repo.upsertModels([model]);
    const thread = await repo.createThread({});
    const otherThread = await repo.createThread({});
    const attachment = await repo.createAttachment({
      threadId: otherThread.id,
      filename: 'file.txt',
      path: 'file.txt',
      mimeType: 'text/plain',
      size: 10,
      kind: 'file',
    });

    const chatService = new ChatService(repo, new MockOpenRouterClient(), '/tmp');

    await expect(
      chatService.sendMessageStream(
        {
          threadId: thread.id,
          content: 'Hi',
          modelId: model.id,
          attachmentIds: [attachment.id],
        },
        () => {},
      ),
    ).rejects.toThrow('Invalid attachment selection');
  });
});
