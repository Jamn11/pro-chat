import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), '../../.env') });

const envSchema = z.object({
  NODE_ENV: z.string().optional(),
  PORT: z.coerce.number().default(8787),
  OPENROUTER_APP_URL: z.string().optional(),
  OPENROUTER_APP_NAME: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  STORAGE_PATH: z.string().default('storage'),
  MEMORY_PATH: z.string().optional(),
  // Web fetch tool
  WEB_FETCH_ALLOW_DOMAINS: z.string().optional(),
  WEB_FETCH_DENY_DOMAINS: z.string().optional(),
  WEB_FETCH_MAX_REDIRECTS: z.coerce.number().optional(),
  WEB_FETCH_RENDER_MODE: z.enum(['off', 'auto', 'always']).optional(),
  WEB_FETCH_RENDER_URL: z.string().optional(),
  WEB_FETCH_RENDER_HEADER: z.string().optional(),
  WEB_FETCH_RENDER_TOKEN: z.string().optional(),
  // Trace settings
  TRACE_MAX_EVENTS: z.coerce.number().default(120),
  TRACE_MAX_CHARS: z.coerce.number().default(50_000),
  TRACE_MAX_SOURCES: z.coerce.number().default(40),
  TRACE_MAX_SOURCE_CHARS: z.coerce.number().default(40_000),
  TRACE_MAX_SOURCE_SNIPPET_CHARS: z.coerce.number().default(600),
  TRACE_RETENTION_DAYS: z.coerce.number().default(30),
});

export const env = envSchema.parse({
  NODE_ENV: process.env.NODE_ENV,
  PORT: process.env.PORT,
  OPENROUTER_APP_URL: process.env.OPENROUTER_APP_URL,
  OPENROUTER_APP_NAME: process.env.OPENROUTER_APP_NAME,
  DATABASE_URL: process.env.DATABASE_URL,
  STORAGE_PATH: process.env.STORAGE_PATH,
  MEMORY_PATH: process.env.MEMORY_PATH,
  WEB_FETCH_ALLOW_DOMAINS: process.env.WEB_FETCH_ALLOW_DOMAINS,
  WEB_FETCH_DENY_DOMAINS: process.env.WEB_FETCH_DENY_DOMAINS,
  WEB_FETCH_MAX_REDIRECTS: process.env.WEB_FETCH_MAX_REDIRECTS,
  WEB_FETCH_RENDER_MODE: process.env.WEB_FETCH_RENDER_MODE,
  WEB_FETCH_RENDER_URL: process.env.WEB_FETCH_RENDER_URL,
  WEB_FETCH_RENDER_HEADER: process.env.WEB_FETCH_RENDER_HEADER,
  WEB_FETCH_RENDER_TOKEN: process.env.WEB_FETCH_RENDER_TOKEN,
  TRACE_MAX_EVENTS: process.env.TRACE_MAX_EVENTS,
  TRACE_MAX_CHARS: process.env.TRACE_MAX_CHARS,
  TRACE_MAX_SOURCES: process.env.TRACE_MAX_SOURCES,
  TRACE_MAX_SOURCE_CHARS: process.env.TRACE_MAX_SOURCE_CHARS,
  TRACE_MAX_SOURCE_SNIPPET_CHARS: process.env.TRACE_MAX_SOURCE_SNIPPET_CHARS,
  TRACE_RETENTION_DAYS: process.env.TRACE_RETENTION_DAYS,
});
