import path from 'path';
import { env } from './env';
import { createApp } from './app';
import { PrismaChatRepository } from './repositories/prismaRepo';
import { OpenRouterClient } from './services/openrouter';
import { ChatService } from './services/chatService';
import { MODEL_SEED } from './modelSeed';
import { MemoryStore } from './services/memoryStore';
import { MemoryExtractor } from './services/memoryExtractor';
import { PythonTool } from './services/pythonTool';
import { BraveSearchProvider } from './services/braveSearchProvider';
import { SearchTool } from './services/searchTool';
import { WebFetchTool } from './services/webFetchTool';
import { StreamTracker } from './services/streamTracker';
import { startStreamCleanupJob } from './services/streamCleanup';

const repository = new PrismaChatRepository();

const openRouter = new OpenRouterClient({
  apiKey: env.OPENROUTER_API_KEY,
  appUrl: env.OPENROUTER_APP_URL,
  appName: env.OPENROUTER_APP_NAME,
});

const storageRoot = path.isAbsolute(env.STORAGE_PATH)
  ? env.STORAGE_PATH
  : path.resolve(process.cwd(), env.STORAGE_PATH);

const memoryPath = env.MEMORY_PATH
  ? path.isAbsolute(env.MEMORY_PATH)
    ? env.MEMORY_PATH
    : path.resolve(process.cwd(), env.MEMORY_PATH)
  : path.join(storageRoot, 'memory');

const memoryStore = new MemoryStore(memoryPath);
const pythonTool = new PythonTool();
const searchTool = env.BRAVE_SEARCH_API_KEY
  ? new SearchTool(new BraveSearchProvider({ apiKey: env.BRAVE_SEARCH_API_KEY }))
  : undefined;

const parseDomainList = (value?: string): string[] | undefined => {
  if (!value) return undefined;
  const domains = value
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return domains.length > 0 ? domains : undefined;
};

const webFetchTool = new WebFetchTool({
  allowedDomains: parseDomainList(env.WEB_FETCH_ALLOW_DOMAINS),
  blockedDomains: parseDomainList(env.WEB_FETCH_DENY_DOMAINS),
  maxRedirects: env.WEB_FETCH_MAX_REDIRECTS,
  render: env.WEB_FETCH_RENDER_URL
    ? {
        mode: env.WEB_FETCH_RENDER_MODE ?? 'auto',
        url: env.WEB_FETCH_RENDER_URL,
        header: env.WEB_FETCH_RENDER_HEADER,
        token: env.WEB_FETCH_RENDER_TOKEN,
      }
    : undefined,
});

// Stream tracking for resume support
const streamTracker = new StreamTracker(repository);

const chatService = new ChatService(repository, openRouter, storageRoot, {
  memoryStore,
  pythonTool,
  searchTool,
  webFetchTool,
  streamTracker,
  maxToolIterations: 30,
  tracePolicy: {
    maxEvents: env.TRACE_MAX_EVENTS,
    maxChars: env.TRACE_MAX_CHARS,
    maxSources: env.TRACE_MAX_SOURCES,
    maxSourceChars: env.TRACE_MAX_SOURCE_CHARS,
    maxSourceSnippetChars: env.TRACE_MAX_SOURCE_SNIPPET_CHARS,
    retentionDays: env.TRACE_RETENTION_DAYS,
  },
});

const memoryExtractor = new MemoryExtractor(repository, memoryStore, openRouter);

const app = createApp({
  repo: repository,
  chatService,
  storageRoot,
  memoryStore,
  memoryExtractor,
  traceRetentionDays: env.TRACE_RETENTION_DAYS,
  streamTracker,
});

async function bootstrap() {
  // Users are now created on-demand when they authenticate with Clerk
  await repository.upsertModels(MODEL_SEED);
  await memoryStore.ensureExists();

  // Start background cleanup job for stale streams
  startStreamCleanupJob(streamTracker);

  app.listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
