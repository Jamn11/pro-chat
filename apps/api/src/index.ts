import path from 'path';
import { env } from './env';
import { createApp } from './app';
import { PrismaChatRepository } from './repositories/prismaRepo';
import { OpenRouterClient } from './services/openrouter';
import { ChatService } from './services/chatService';
import { MODEL_SEED } from './modelSeed';
import { MemoryStore } from './services/memoryStore';
import { PythonTool } from './services/pythonTool';
import { BraveSearchProvider } from './services/braveSearchProvider';
import { SearchTool } from './services/searchTool';
import { WebFetchTool } from './services/webFetchTool';

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
const webFetchTool = new WebFetchTool();

const chatService = new ChatService(repository, openRouter, storageRoot, {
  memoryStore,
  pythonTool,
  searchTool,
  webFetchTool,
  maxToolIterations: 30,
});

const app = createApp({ repo: repository, chatService, storageRoot });

async function bootstrap() {
  await repository.ensureDefaultUser();
  await repository.upsertModels(MODEL_SEED);
  await memoryStore.ensureExists();

  app.listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
