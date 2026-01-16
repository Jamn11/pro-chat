import { ChatRepository } from '../repositories/types';
import { MemoryStore } from './memoryStore';
import { OpenRouterClient } from './openrouter';
import { MessageRecord } from '../types';

const EXTRACTION_MODEL = 'anthropic/claude-sonnet-4.5';

const EXTRACTION_PROMPT = `You are a memory extraction assistant. Your job is to analyze conversations and extract useful information about the user that should be remembered for future conversations.

Review the conversation below and identify any important facts, preferences, or context about the user. Focus on:
- Personal preferences (coding style, tools, frameworks)
- Project details and tech stack
- Communication style preferences
- Important deadlines or constraints mentioned
- Professional background or expertise
- Any explicit requests to remember something

Output ONLY the new memories to add, one per line. Each line should be a concise, standalone fact.
- Do NOT include anything the memory file already contains
- Do NOT include greetings, pleasantries, or transient information
- Do NOT include information about the current task that won't be relevant later
- If there's nothing worth remembering, output exactly: NO_NEW_MEMORIES

Current memory file contents:
<memory>
{CURRENT_MEMORY}
</memory>

Conversation to analyze:
<conversation>
{CONVERSATION}
</conversation>

New memories to add (one per line, or NO_NEW_MEMORIES):`;

export type MemoryExtractionResult = {
  threadId: string;
  extracted: string[];
  skipped: boolean;
  error?: string;
};

export type MemoryExtractionSummary = {
  processed: number;
  memoriesAdded: number;
  skipped: number;
  errors: number;
  results: MemoryExtractionResult[];
};

export class MemoryExtractor {
  constructor(
    private repo: ChatRepository,
    private memoryStore: MemoryStore,
    private openRouter: OpenRouterClient,
  ) {}

  async extractFromThread(threadId: string): Promise<MemoryExtractionResult> {
    try {
      const messages = await this.repo.getThreadMessages(threadId);
      if (messages.length === 0) {
        return { threadId, extracted: [], skipped: true };
      }

      const currentMemory = await this.memoryStore.read();
      const conversationText = formatConversation(messages);

      const prompt = EXTRACTION_PROMPT
        .replace('{CURRENT_MEMORY}', currentMemory ?? '(empty)')
        .replace('{CONVERSATION}', conversationText);

      let response = '';
      await this.openRouter.streamChat(
        {
          model: EXTRACTION_MODEL,
          messages: [{ role: 'user', content: prompt }],
        },
        {
          onDelta: (delta) => {
            response += delta;
          },
        },
      );

      const trimmed = response.trim();
      if (trimmed === 'NO_NEW_MEMORIES' || !trimmed) {
        await this.repo.markThreadMemoryChecked(threadId);
        return { threadId, extracted: [], skipped: true };
      }

      const newMemories = trimmed
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && line !== 'NO_NEW_MEMORIES');

      if (newMemories.length > 0) {
        for (const memory of newMemories) {
          await this.memoryStore.append(memory);
        }
      }

      await this.repo.markThreadMemoryChecked(threadId);
      return { threadId, extracted: newMemories, skipped: false };
    } catch (error) {
      return {
        threadId,
        extracted: [],
        skipped: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async extractFromUncheckedThreads(userId: string): Promise<MemoryExtractionSummary> {
    const threads = await this.repo.getThreadsForMemoryExtraction(userId);
    const results: MemoryExtractionResult[] = [];
    let memoriesAdded = 0;
    let skipped = 0;
    let errors = 0;

    for (const thread of threads) {
      const result = await this.extractFromThread(thread.id);
      results.push(result);

      if (result.error) {
        errors++;
      } else if (result.skipped) {
        skipped++;
      } else {
        memoriesAdded += result.extracted.length;
      }
    }

    return {
      processed: threads.length,
      memoriesAdded,
      skipped,
      errors,
      results,
    };
  }
}

function formatConversation(messages: MessageRecord[]): string {
  return messages
    .map((msg) => {
      const role = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
      return `${role}: ${msg.content}`;
    })
    .join('\n\n');
}
