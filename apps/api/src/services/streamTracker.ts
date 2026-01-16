import { ChatRepository } from '../repositories/types';
import { ActiveStreamRecord, ThinkingLevel, TraceEvent } from '../types';

export type StartStreamInput = {
  threadId: string;
  userMessageId: string;
  modelId: string;
  thinkingLevel?: ThinkingLevel | null;
};

export type StreamProgressUpdate = {
  content: string;
  trace?: TraceEvent[] | null;
};

const TIMEOUT_MS = 2 * 60 * 1000; // 2 minutes
const UPDATE_DEBOUNCE_MS = 2000; // 2 seconds
const UPDATE_CHAR_THRESHOLD = 500; // Update every 500 chars

export class StreamTracker {
  private pendingUpdates = new Map<string, StreamProgressUpdate>();
  private updateTimers = new Map<string, NodeJS.Timeout>();
  private lastUpdateChars = new Map<string, number>();

  constructor(private repo: ChatRepository) {}

  /**
   * Create a new stream record when streaming begins
   */
  async startStream(input: StartStreamInput): Promise<ActiveStreamRecord> {
    // Cancel any existing active stream for this thread first
    const existing = await this.repo.getActiveStreamByThread(input.threadId);
    if (existing) {
      await this.cancelStream(existing.id);
    }

    const stream = await this.repo.createActiveStream({
      threadId: input.threadId,
      userMessageId: input.userMessageId,
      modelId: input.modelId,
      thinkingLevel: input.thinkingLevel,
    });

    this.lastUpdateChars.set(stream.id, 0);
    return stream;
  }

  /**
   * Update partial content during streaming (debounced)
   */
  async updateProgress(
    streamId: string,
    content: string,
    trace?: TraceEvent[] | null,
  ): Promise<void> {
    // Store the latest update
    this.pendingUpdates.set(streamId, { content, trace });

    // Check if we should flush immediately based on character count
    const lastChars = this.lastUpdateChars.get(streamId) ?? 0;
    const charsSinceLastUpdate = content.length - lastChars;

    if (charsSinceLastUpdate >= UPDATE_CHAR_THRESHOLD) {
      await this.flushUpdate(streamId);
      return;
    }

    // Otherwise, debounce the update
    const existingTimer = this.updateTimers.get(streamId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    const timer = setTimeout(() => {
      this.flushUpdate(streamId).catch(console.error);
    }, UPDATE_DEBOUNCE_MS);

    this.updateTimers.set(streamId, timer);
  }

  /**
   * Flush pending updates to the database
   */
  private async flushUpdate(streamId: string): Promise<void> {
    const update = this.pendingUpdates.get(streamId);
    if (!update) return;

    // Clear timer and pending update
    const timer = this.updateTimers.get(streamId);
    if (timer) {
      clearTimeout(timer);
      this.updateTimers.delete(streamId);
    }
    this.pendingUpdates.delete(streamId);

    // Update the database
    try {
      await this.repo.updateActiveStream(streamId, {
        partialContent: update.content,
        partialTrace: update.trace,
        lastActivityAt: new Date(),
      });
      this.lastUpdateChars.set(streamId, update.content.length);
    } catch (error) {
      // Stream might have been deleted/completed, ignore
      console.error('Failed to update stream progress:', error);
    }
  }

  /**
   * Mark stream as pending (client disconnected but may resume)
   */
  async markPending(streamId: string): Promise<void> {
    // Flush any pending updates first
    await this.flushUpdate(streamId);

    try {
      await this.repo.updateActiveStream(streamId, {
        status: 'pending',
        lastActivityAt: new Date(),
      });
    } catch (error) {
      console.error('Failed to mark stream as pending:', error);
    }
  }

  /**
   * Set the assistant message ID once it's created
   */
  async setAssistantMessageId(streamId: string, assistantMessageId: string): Promise<void> {
    await this.repo.updateActiveStream(streamId, {
      assistantMessageId,
      lastActivityAt: new Date(),
    });
  }

  /**
   * Complete stream successfully
   */
  async completeStream(streamId: string): Promise<void> {
    // Clear any pending updates/timers
    const timer = this.updateTimers.get(streamId);
    if (timer) {
      clearTimeout(timer);
      this.updateTimers.delete(streamId);
    }
    this.pendingUpdates.delete(streamId);
    this.lastUpdateChars.delete(streamId);

    try {
      await this.repo.updateActiveStream(streamId, {
        status: 'completed',
        completedAt: new Date(),
      });
    } catch (error) {
      console.error('Failed to complete stream:', error);
    }
  }

  /**
   * Mark stream as failed
   */
  async failStream(streamId: string): Promise<void> {
    // Flush any pending updates first
    await this.flushUpdate(streamId);

    // Clear timers
    this.lastUpdateChars.delete(streamId);

    try {
      await this.repo.updateActiveStream(streamId, {
        status: 'failed',
        completedAt: new Date(),
      });
    } catch (error) {
      console.error('Failed to mark stream as failed:', error);
    }
  }

  /**
   * Cancel stream (user clicked stop)
   */
  async cancelStream(streamId: string): Promise<void> {
    // Clear any pending updates/timers
    const timer = this.updateTimers.get(streamId);
    if (timer) {
      clearTimeout(timer);
      this.updateTimers.delete(streamId);
    }
    this.pendingUpdates.delete(streamId);
    this.lastUpdateChars.delete(streamId);

    try {
      await this.repo.updateActiveStream(streamId, {
        status: 'cancelled',
        completedAt: new Date(),
      });
    } catch (error) {
      console.error('Failed to cancel stream:', error);
    }
  }

  /**
   * Find a resumable stream for a thread (status: pending)
   */
  async findResumableStream(threadId: string): Promise<ActiveStreamRecord | null> {
    const stream = await this.repo.getActiveStreamByThread(threadId);
    if (!stream) return null;

    // Only return pending streams that haven't timed out
    if (stream.status !== 'pending') return null;

    const age = Date.now() - stream.lastActivityAt.getTime();
    if (age > TIMEOUT_MS) {
      // Stream has timed out, mark as failed
      await this.failStream(stream.id);
      return null;
    }

    return stream;
  }

  /**
   * Get an active stream by ID
   */
  async getStream(streamId: string): Promise<ActiveStreamRecord | null> {
    return this.repo.getActiveStream(streamId);
  }

  /**
   * Cleanup stale streams (called by background job)
   */
  async cleanupStaleStreams(): Promise<number> {
    const cutoff = new Date(Date.now() - TIMEOUT_MS);
    const staleStreams = await this.repo.findStaleActiveStreams(cutoff);

    let count = 0;
    for (const stream of staleStreams) {
      try {
        await this.repo.updateActiveStream(stream.id, {
          status: 'failed',
          completedAt: new Date(),
        });
        count++;
      } catch (error) {
        console.error(`Failed to mark stream ${stream.id} as failed:`, error);
      }
    }

    return count;
  }

  /**
   * Delete old completed/failed streams (called by background job)
   */
  async deleteOldStreams(maxAge: number = 24 * 60 * 60 * 1000): Promise<number> {
    const cutoff = new Date(Date.now() - maxAge);
    return this.repo.deleteOldActiveStreams(cutoff);
  }
}
