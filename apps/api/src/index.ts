import path from 'path';
import { env } from './env';
import { createApp } from './app';
import { PrismaChatRepository } from './repositories/prismaRepo';
import { OpenRouterClient } from './services/openrouter';
import { ChatService } from './services/chatService';
import { MODEL_SEED } from './modelSeed';

const repository = new PrismaChatRepository();

const openRouter = new OpenRouterClient({
  apiKey: env.OPENROUTER_API_KEY,
  appUrl: env.OPENROUTER_APP_URL,
  appName: env.OPENROUTER_APP_NAME,
});

const storageRoot = path.isAbsolute(env.STORAGE_PATH)
  ? env.STORAGE_PATH
  : path.resolve(process.cwd(), env.STORAGE_PATH);

const chatService = new ChatService(repository, openRouter, storageRoot);

const app = createApp({ repo: repository, chatService, storageRoot });

async function bootstrap() {
  await repository.ensureDefaultUser();
  await repository.upsertModels(MODEL_SEED);

  app.listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT}`);
  });
}

bootstrap().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
