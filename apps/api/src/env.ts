import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().default(8787),
  OPENROUTER_API_KEY: z.string().min(1),
  OPENROUTER_APP_URL: z.string().optional(),
  OPENROUTER_APP_NAME: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  STORAGE_PATH: z.string().default('storage'),
});

export const env = envSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  OPENROUTER_APP_URL: process.env.OPENROUTER_APP_URL,
  OPENROUTER_APP_NAME: process.env.OPENROUTER_APP_NAME,
  DATABASE_URL: process.env.DATABASE_URL,
  STORAGE_PATH: process.env.STORAGE_PATH,
});
