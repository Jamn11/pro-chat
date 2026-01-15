import { OpenRouterToolCall, OpenRouterToolDefinition } from './openrouter';
import { MemoryStore } from './memoryStore';

export const MEMORY_APPEND_TOOL_NAME = 'memory_append';
export const MEMORY_WRITE_TOOL_NAME = 'memory_write';

export const memoryAppendToolDefinition: OpenRouterToolDefinition = {
  type: 'function',
  function: {
    name: MEMORY_APPEND_TOOL_NAME,
    description:
      'Append new information to the user\'s memory file. Use this to save important facts, preferences, or context about the user that should be remembered across conversations. Each entry should be a concise, standalone fact.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'The information to add to memory. Should be a concise fact or preference about the user, like "User prefers TypeScript over JavaScript" or "User\'s project uses React and Next.js".',
        },
      },
      required: ['content'],
    },
  },
};

export const memoryWriteToolDefinition: OpenRouterToolDefinition = {
  type: 'function',
  function: {
    name: MEMORY_WRITE_TOOL_NAME,
    description:
      'Completely replace the user\'s memory file with new content. Use this sparingly, only when the memory needs to be reorganized or cleaned up. For adding new information, prefer memory_append instead.',
    parameters: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description:
            'The complete new content for the memory file. Should be well-organized with one fact per line.',
        },
      },
      required: ['content'],
    },
  },
};

export type MemoryToolResult = {
  success: boolean;
  message: string;
  currentMemory?: string;
};

export class MemoryTool {
  constructor(private memoryStore: MemoryStore) {}

  async append(content: string): Promise<MemoryToolResult> {
    const trimmed = content.trim();
    if (!trimmed) {
      return {
        success: false,
        message: 'No content provided to append.',
      };
    }

    await this.memoryStore.append(trimmed);
    const currentMemory = await this.memoryStore.read();

    return {
      success: true,
      message: `Successfully appended to memory: "${trimmed}"`,
      currentMemory: currentMemory ?? undefined,
    };
  }

  async write(content: string): Promise<MemoryToolResult> {
    const trimmed = content.trim();

    await this.memoryStore.write(trimmed);
    const currentMemory = await this.memoryStore.read();

    return {
      success: true,
      message: trimmed
        ? 'Successfully replaced memory with new content.'
        : 'Successfully cleared memory.',
      currentMemory: currentMemory ?? undefined,
    };
  }

  async runToolCall(toolCall: OpenRouterToolCall): Promise<string> {
    const argumentsPayload = toolCall.function.arguments ?? '';
    let content = '';

    try {
      const parsed = JSON.parse(argumentsPayload);
      content = typeof parsed?.content === 'string' ? parsed.content : '';
    } catch (error) {
      return JSON.stringify({
        success: false,
        message: 'Invalid tool arguments. Expected JSON with a content string.',
      } satisfies MemoryToolResult);
    }

    if (toolCall.function.name === MEMORY_APPEND_TOOL_NAME) {
      const result = await this.append(content);
      return JSON.stringify(result);
    }

    if (toolCall.function.name === MEMORY_WRITE_TOOL_NAME) {
      const result = await this.write(content);
      return JSON.stringify(result);
    }

    return JSON.stringify({
      success: false,
      message: `Unknown memory tool: ${toolCall.function.name}`,
    } satisfies MemoryToolResult);
  }
}
