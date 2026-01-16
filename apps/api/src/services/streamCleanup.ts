import { StreamTracker } from './streamTracker';

const DEFAULT_CLEANUP_INTERVAL = 30 * 1000; // 30 seconds
const DEFAULT_MAX_STREAM_AGE = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Start a background job that periodically cleans up stale and old streams.
 *
 * This job:
 * 1. Marks streams as 'failed' if they've been active/pending for > 2 minutes without activity
 * 2. Deletes completed/failed/cancelled streams older than 24 hours
 *
 * @param streamTracker - The StreamTracker instance to use for cleanup
 * @param intervalMs - How often to run the cleanup (default: 30 seconds)
 * @returns The interval ID (can be used to stop the job with clearInterval)
 */
export function startStreamCleanupJob(
  streamTracker: StreamTracker,
  intervalMs: number = DEFAULT_CLEANUP_INTERVAL,
): NodeJS.Timeout {
  const runCleanup = async () => {
    try {
      // Mark stale streams as failed
      const staleCount = await streamTracker.cleanupStaleStreams();
      if (staleCount > 0) {
        console.log(`[StreamCleanup] Marked ${staleCount} stale stream(s) as failed`);
      }

      // Delete old completed/failed streams
      const deletedCount = await streamTracker.deleteOldStreams(DEFAULT_MAX_STREAM_AGE);
      if (deletedCount > 0) {
        console.log(`[StreamCleanup] Deleted ${deletedCount} old stream record(s)`);
      }
    } catch (error) {
      console.error('[StreamCleanup] Cleanup job failed:', error);
    }
  };

  // Run immediately on start, then on interval
  runCleanup();

  return setInterval(runCleanup, intervalMs);
}
