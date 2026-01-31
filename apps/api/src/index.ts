import path from 'path';
import fs from 'fs';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import { env } from './env';
import { createApp } from './app';
import { PrismaChatRepository } from './repositories/prismaRepo';
import { OpenRouterClient } from './services/openrouter';
import { ChatService } from './services/chatService';
import { MODEL_SEED } from './modelSeed';
import { MemoryStore } from './services/memoryStore';
import { MemoryExtractor } from './services/memoryExtractor';
import { PythonTool } from './services/pythonTool';
import { WebFetchTool } from './services/webFetchTool';
import { StreamTracker } from './services/streamTracker';
import { startStreamCleanupJob } from './services/streamCleanup';

const repository = new PrismaChatRepository();

const openRouterFactory = (apiKey: string) =>
  new OpenRouterClient({
    apiKey,
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

const chatService = new ChatService(repository, openRouterFactory, storageRoot, {
  memoryStore,
  pythonTool,
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

const memoryExtractor = new MemoryExtractor(repository, memoryStore, openRouterFactory);

const app = createApp({
  repo: repository,
  chatService,
  storageRoot,
  memoryStore,
  memoryExtractor,
  traceRetentionDays: env.TRACE_RETENTION_DAYS,
  streamTracker,
});

const resolveSqlitePath = (databaseUrl: string, schemaDir: string): string => {
  if (databaseUrl.startsWith('file://')) {
    return fileURLToPath(databaseUrl);
  }
  const rawPath = databaseUrl.replace(/^file:/, '').split('?')[0];
  if (rawPath.startsWith('/')) {
    return rawPath;
  }
  return path.resolve(schemaDir, rawPath);
};

const resolvePrismaCli = (): string => {
  const candidates = [
    path.resolve(process.cwd(), '..', 'node_modules', 'prisma', 'build', 'index.js'),
    path.resolve(process.cwd(), '..', '..', 'node_modules', 'prisma', 'build', 'index.js'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0];
};

async function bootstrap() {
  if (env.DATABASE_URL.startsWith('file:')) {
    const schemaPath = path.resolve(process.cwd(), 'prisma', 'schema.prisma');
    const schemaDir = path.dirname(schemaPath);
    const dbPath = resolveSqlitePath(env.DATABASE_URL, schemaDir);
    if (!fs.existsSync(dbPath)) {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
      const prismaCli = resolvePrismaCli();
      const result = spawnSync(process.execPath, [prismaCli, 'db', 'push', '--schema', schemaPath], {
        stdio: 'inherit',
        env: process.env,
      });
      if (result.status !== 0) {
        throw new Error('Failed to initialize SQLite database via prisma db push.');
      }
    }
  }

  // Models and local storage bootstrap
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
