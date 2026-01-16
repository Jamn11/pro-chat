import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { ChatService } from './services/chatService';
import { ChatRepository } from './repositories/types';
import { MemoryStore } from './services/memoryStore';
import { MemoryExtractor } from './services/memoryExtractor';
import { clerkAuthMiddleware, requireAuthentication, syncUserMiddleware, getUserId } from './middleware/clerkAuth';
import { StreamTracker } from './services/streamTracker';

const uploadSchema = z.object({
  threadId: z.string().min(1),
});

const createThreadSchema = z.object({
  title: z.string().optional().nullable(),
});

const settingsSchema = z.object({
  systemPrompt: z.string().optional().nullable(),
});

const memorySchema = z.object({
  content: z.string(),
});

const streamSchema = z.object({
  threadId: z.string().min(1),
  content: z.string().min(1),
  modelId: z.string().min(1),
  thinkingLevel: z.enum(['low', 'medium', 'high', 'xhigh']).optional().nullable(),
  attachmentIds: z.array(z.string()).optional(),
  clientContext: z
    .object({
      iso: z.string().min(1),
      local: z.string().min(1),
      timeZone: z.string().optional(),
      offsetMinutes: z.number().optional(),
    })
    .optional(),
});

const resumeSchema = z.object({
  streamId: z.string().min(1),
});

const storageFilename = (originalName: string) =>
  `${Date.now()}-${randomUUID()}-${originalName.replace(/\s+/g, '_')}`;

export function createApp({
  repo,
  chatService,
  storageRoot,
  memoryStore,
  memoryExtractor,
  traceRetentionDays,
  streamTracker,
}: {
  repo: ChatRepository;
  chatService: ChatService;
  storageRoot: string;
  memoryStore?: MemoryStore;
  memoryExtractor?: MemoryExtractor;
  traceRetentionDays?: number;
  streamTracker?: StreamTracker;
}) {
  const app = express();

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  // Clerk authentication middleware
  app.use(clerkAuthMiddleware);

  const upload = multer({
    storage: multer.diskStorage({
      destination: async (_req, _file, cb) => {
        await fs.promises.mkdir(storageRoot, { recursive: true });
        cb(null, storageRoot);
      },
      filename: (_req, file, cb) => {
        cb(null, storageFilename(file.originalname));
      },
    }),
  });

  // Public routes (no authentication required)
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // Protected routes - require authentication and sync user to database
  app.use('/api', requireAuthentication, syncUserMiddleware(repo));

  app.get('/api/models', async (_req, res, next) => {
    try {
      const models = await repo.listModels();
      res.json({ models });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/settings', async (req, res, next) => {
    try {
      const userId = getUserId(req);
      const settings = await repo.getSettings(userId);
      res.json(settings);
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/settings', async (req, res, next) => {
    try {
      const userId = getUserId(req);
      const parsed = settingsSchema.parse(req.body);
      const updated = await repo.updateSettings(userId, parsed.systemPrompt ?? null);
      res.json(updated);
    } catch (error) {
      next(error);
    }
  });

  // Memory endpoints
  app.get('/api/memory', async (_req, res, next) => {
    try {
      if (!memoryStore) {
        res.status(503).json({ error: 'Memory store not configured' });
        return;
      }
      const content = await memoryStore.read();
      res.json({ content: content ?? '' });
    } catch (error) {
      next(error);
    }
  });

  app.put('/api/memory', async (req, res, next) => {
    try {
      if (!memoryStore) {
        res.status(503).json({ error: 'Memory store not configured' });
        return;
      }
      const parsed = memorySchema.parse(req.body);
      await memoryStore.write(parsed.content);
      res.json({ content: parsed.content });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/memory/extract', async (req, res, next) => {
    try {
      if (!memoryExtractor) {
        res.status(503).json({ error: 'Memory extractor not configured' });
        return;
      }
      const userId = getUserId(req);
      const result = await memoryExtractor.extractFromUncheckedThreads(userId);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/threads', async (req, res, next) => {
    try {
      const userId = getUserId(req);
      const threads = await repo.listThreads(userId);
      res.json({ threads });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/threads', async (req, res, next) => {
    try {
      const userId = getUserId(req);
      const parsed = createThreadSchema.parse(req.body ?? {});
      const thread = await repo.createThread({ userId, title: parsed.title ?? null });
      res.status(201).json(thread);
    } catch (error) {
      next(error);
    }
  });

  app.delete('/api/threads/:id', async (req, res, next) => {
    try {
      const threadId = req.params.id;
      const attachments = await repo.listAttachmentsForThread(threadId);
      await repo.deleteThread(threadId);
      await Promise.all(
        attachments.map(async (attachment) => {
          const filePath = path.isAbsolute(attachment.path)
            ? attachment.path
            : path.join(storageRoot, attachment.path);
          try {
            await fs.promises.unlink(filePath);
          } catch (error) {
            // Ignore missing files for now.
          }
        }),
      );
      res.status(204).send();
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/threads/:id/messages', async (req, res, next) => {
    try {
      const threadId = req.params.id;
      if (traceRetentionDays && traceRetentionDays > 0) {
        const cutoff = new Date(Date.now() - traceRetentionDays * 24 * 60 * 60 * 1000);
        await repo.pruneMessageArtifacts(cutoff);
      }
      const messages = await repo.getThreadMessages(threadId);
      const payload = messages.map((message) => ({
        ...message,
        attachments: message.attachments?.map((attachment) => ({
          ...attachment,
          url: `/api/attachments/${attachment.id}`,
        })),
      }));
      res.json({ messages: payload });
    } catch (error) {
      next(error);
    }
  });

  // Check for active/pending stream on a thread
  app.get('/api/threads/:id/active-stream', async (req, res, next) => {
    try {
      if (!streamTracker) {
        res.json({ hasActiveStream: false });
        return;
      }

      const threadId = req.params.id;
      const stream = await streamTracker.findResumableStream(threadId);

      if (!stream) {
        res.json({ hasActiveStream: false });
        return;
      }

      res.json({
        hasActiveStream: true,
        stream: {
          id: stream.id,
          userMessageId: stream.userMessageId,
          assistantMessageId: stream.assistantMessageId,
          partialContent: stream.partialContent,
          partialTrace: stream.partialTrace,
          status: stream.status,
          startedAt: stream.startedAt.toISOString(),
          lastActivityAt: stream.lastActivityAt.toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/attachments/:id', async (req, res, next) => {
    try {
      const [attachment] = await repo.getAttachmentsByIds([req.params.id]);
      if (!attachment) {
        res.status(404).json({ error: 'Attachment not found' });
        return;
      }
      const filePath = path.isAbsolute(attachment.path)
        ? attachment.path
        : path.join(storageRoot, attachment.path);
      res.type(attachment.mimeType);
      res.sendFile(filePath);
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/uploads', upload.array('files'), async (req, res, next) => {
    try {
      const parsed = uploadSchema.parse(req.body);
      const files = (req.files as Express.Multer.File[]) || [];
      const attachments = await Promise.all(
        files.map((file) =>
          repo.createAttachment({
            threadId: parsed.threadId,
            filename: file.originalname,
            path: file.filename,
            mimeType: file.mimetype,
            size: file.size,
            kind: file.mimetype.startsWith('image/') ? 'image' : 'file',
          }),
        ),
      );
      const payload = attachments.map((attachment) => ({
        ...attachment,
        url: `/api/attachments/${attachment.id}`,
      }));
      res.status(201).json({ attachments: payload });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/chat/stream', async (req, res, next) => {
    let sendEvent: ((event: string, data: unknown) => void) | null = null;
    let currentStreamId: string | undefined;

    try {
      const userId = getUserId(req);
      const parsed = streamSchema.parse(req.body);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      sendEvent = (event: string, data: unknown) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      sendEvent('meta', { threadId: parsed.threadId, modelId: parsed.modelId });

      const abortController = new AbortController();
      let streamAborted = false;

      const abortStream = async () => {
        if (!res.writableEnded && !streamAborted) {
          streamAborted = true;
          abortController.abort();

          // Mark stream as pending if we have a stream ID (client disconnected)
          if (currentStreamId && streamTracker) {
            try {
              await streamTracker.markPending(currentStreamId);
            } catch (err) {
              console.error('Failed to mark stream as pending:', err);
            }
          }
        }
      };

      req.on('aborted', abortStream);
      res.on('close', abortStream);

      const result = await chatService.sendMessageStream(
        {
          userId,
          threadId: parsed.threadId,
          content: parsed.content,
          modelId: parsed.modelId,
          thinkingLevel: parsed.thinkingLevel ?? null,
          attachmentIds: parsed.attachmentIds ?? [],
          clientContext: parsed.clientContext,
        },
        (chunk) => {
          sendEvent?.('delta', { content: chunk });
        },
        abortController.signal,
        {
          onToolStart: (toolName) => {
            sendEvent?.('tool', { name: toolName });
          },
          onReasoning: (delta) => {
            sendEvent?.('reasoning', { delta });
          },
          onStreamStart: (streamId) => {
            // Capture stream ID immediately for abort handling
            currentStreamId = streamId;
            sendEvent?.('streamId', { streamId });
          },
        },
      );

      sendEvent('done', {
        userMessage: result.userMessage,
        assistantMessage: result.assistantMessage,
        totalCost: result.totalCost,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        durationMs: result.durationMs,
      });
      res.end();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        // Stream was aborted (client disconnected) - already marked as pending
        res.end();
        return;
      }

      // Mark stream as failed on error
      if (currentStreamId && streamTracker) {
        try {
          await streamTracker.failStream(currentStreamId);
        } catch (err) {
          console.error('Failed to mark stream as failed:', err);
        }
      }

      if (sendEvent) {
        sendEvent('error', { message: error instanceof Error ? error.message : 'Unknown error' });
        res.end();
        return;
      }
      next(error);
    }
  });

  // Resume a pending stream
  app.post('/api/chat/resume', async (req, res, next) => {
    let sendEvent: ((event: string, data: unknown) => void) | null = null;

    try {
      const parsed = resumeSchema.parse(req.body);

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      sendEvent = (event: string, data: unknown) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      const abortController = new AbortController();
      let streamAborted = false;

      const abortStream = async () => {
        if (!res.writableEnded && !streamAborted) {
          streamAborted = true;
          abortController.abort();

          // Mark stream as pending again if aborted during resume
          if (streamTracker) {
            try {
              await streamTracker.markPending(parsed.streamId);
            } catch (err) {
              console.error('Failed to mark stream as pending:', err);
            }
          }
        }
      };

      req.on('aborted', abortStream);
      res.on('close', abortStream);

      const result = await chatService.resumeStream(
        parsed.streamId,
        (chunk) => {
          sendEvent?.('delta', { content: chunk });
        },
        (catchupData) => {
          sendEvent?.('catchup', catchupData);
        },
        abortController.signal,
        {
          onToolStart: (toolName) => {
            sendEvent?.('tool', { name: toolName });
          },
          onReasoning: (delta) => {
            sendEvent?.('reasoning', { delta });
          },
        },
      );

      sendEvent('done', {
        userMessage: result.userMessage,
        assistantMessage: result.assistantMessage,
        totalCost: result.totalCost,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        durationMs: result.durationMs,
      });
      res.end();
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        res.end();
        return;
      }
      if (sendEvent) {
        sendEvent('error', { message: error instanceof Error ? error.message : 'Unknown error' });
        res.end();
        return;
      }
      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(400).json({ error: message });
  });

  return app;
}
