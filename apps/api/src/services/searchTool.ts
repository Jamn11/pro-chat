import { OpenRouterToolCall, OpenRouterToolDefinition } from './openrouter';

export const SEARCH_TOOL_NAME = 'search';

export type SearchResult = {
  title: string;
  url: string;
  snippet?: string;
};

export type SearchProvider = {
  search: (query: string, options?: { limit?: number }) => Promise<SearchResult[]>;
};

export const searchToolDefinition: OpenRouterToolDefinition = {
  type: 'function',
  function: {
    name: SEARCH_TOOL_NAME,
    description:
      'Search the web for up-to-date information and return a list of relevant results.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query.',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of results to return.',
        },
      },
      required: ['query'],
    },
  },
};

export class SearchTool {
  constructor(private provider: SearchProvider) {}

  async runToolCall(toolCall: OpenRouterToolCall): Promise<string> {
    const argumentsPayload = toolCall.function.arguments ?? '';
    let query = '';
    let limit = 5;
    try {
      const parsed = JSON.parse(argumentsPayload);
      query = typeof parsed?.query === 'string' ? parsed.query : '';
      if (typeof parsed?.limit === 'number' && Number.isFinite(parsed.limit)) {
        limit = Math.max(1, Math.min(10, Math.round(parsed.limit)));
      }
    } catch (error) {
      return JSON.stringify({
        results: [],
        error: 'Invalid tool arguments. Expected JSON with a query string.',
      });
    }

    if (!query.trim()) {
      return JSON.stringify({
        results: [],
        error: 'Search query is required.',
      });
    }

    try {
      const results = await this.provider.search(query, { limit });
      return JSON.stringify({ results });
    } catch (error) {
      return JSON.stringify({
        results: [],
        error: error instanceof Error ? error.message : 'Search failed.',
      });
    }
  }
}
