import { Request, Response } from 'express';
import { env } from '../config/env';
import { getErrorMessage } from '../utils/errorMessage';

// Server-sent-events hub for batch upload progress. The upload endpoint writes
// events keyed by progressId; the progress endpoint registers the client
// response that receives them.

const progressMap = new Map<string, Response>();
const progressHeartbeatMap = new Map<string, NodeJS.Timeout>();
const PROGRESS_RETENTION_MS = 10 * 60 * 1000;
type RetainedEvent = { payload: unknown; updatedAt: number };
type RetainedProgress = { progress?: RetainedEvent; terminal?: RetainedEvent & { event: 'complete' | 'error' } };
const retainedProgressMap = new Map<string, RetainedProgress>();

const pruneExpiredProgress = (now = Date.now()): void => {
  for (const [progressId, retained] of retainedProgressMap) {
    if (retained.progress && now - retained.progress.updatedAt >= PROGRESS_RETENTION_MS) {
      delete retained.progress;
    }
    if (retained.terminal && now - retained.terminal.updatedAt >= PROGRESS_RETENTION_MS) {
      delete retained.terminal;
    }
    if (!retained.progress && !retained.terminal) retainedProgressMap.delete(progressId);
  }
};

const writeSseEvent = (res: Response, event: string, payload: unknown): void => {
  if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
};

const writeProgressEvent = (progressId: string, event: string, payload: unknown): void => {
  const now = Date.now();
  pruneExpiredProgress(now);
  const retained = retainedProgressMap.get(progressId) ?? {};
  if (event === 'progress') retained.progress = { payload, updatedAt: now };
  if (event === 'complete' || event === 'error') retained.terminal = { payload, updatedAt: now, event };
  retainedProgressMap.set(progressId, retained);

  const clientResponse = progressMap.get(progressId);
  if (!clientResponse || clientResponse.writableEnded) {
    return;
  }
  writeSseEvent(clientResponse, event, payload);
};

const endProgressStream = (progressId: string): void => {
  const clientResponse = progressMap.get(progressId);
  if (clientResponse && !clientResponse.writableEnded) {
    clientResponse.end();
  }
  progressMap.delete(progressId);
  const heartbeat = progressHeartbeatMap.get(progressId);
  if (heartbeat) {
    clearInterval(heartbeat);
    progressHeartbeatMap.delete(progressId);
  }
};

/** Reuse the request origin only when runtime CORS configuration allows it. */
export const selectProgressResponseOrigin = (
  requestOrigin: string | undefined,
  allowedOrigins: readonly string[] = env.CORS_ORIGINS,
): string | undefined => requestOrigin && allowedOrigins.includes(requestOrigin)
  ? requestOrigin
  : allowedOrigins[0];

/** Register an SSE client for a progressId and start its keepalive heartbeat. */
export const registerProgressClient = (progressId: string, req: Request, res: Response): void => {
  pruneExpiredProgress();
  const responseOrigin = selectProgressResponseOrigin(req.headers.origin);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    ...(responseOrigin ? { 'Access-Control-Allow-Origin': responseOrigin } : {}),
    'Access-Control-Allow-Credentials': 'true',
    'Vary': 'Origin',
  });

  progressMap.set(progressId, res);
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) {
      res.write(': keepalive\n\n');
    }
  }, 15000);
  progressHeartbeatMap.set(progressId, heartbeat);

  writeSseEvent(res, 'initial', { message: 'Connected to batch upload progress stream.', progressId });
  const retained = retainedProgressMap.get(progressId);
  if (retained?.progress) writeSseEvent(res, 'progress', retained.progress.payload);
  if (retained?.terminal) {
    writeSseEvent(res, retained.terminal.event, retained.terminal.payload);
    endProgressStream(progressId);
  }

  req.on('close', () => {
    if (progressMap.get(progressId) === res) {
      progressMap.delete(progressId);
    }
    const currentHeartbeat = progressHeartbeatMap.get(progressId);
    if (currentHeartbeat) {
      clearInterval(currentHeartbeat);
      progressHeartbeatMap.delete(progressId);
    }
  });
};

/** Stream a batch upload's progress events to a progressId's client, if one connected. */
export const streamBatchUpload = async (
  progressId: string,
  upload: (onProgress: (payload: unknown) => void) => Promise<object>,
): Promise<void> => {
  try {
    const batchResults = await upload((payload) => writeProgressEvent(progressId, 'progress', payload));
    writeProgressEvent(progressId, 'complete', { status: 'complete', message: 'Batch upload process finished.', ...batchResults });
    endProgressStream(progressId);
  } catch (error: unknown) {
    console.error('Error in batch upload endpoint:', error);
    const message = getErrorMessage(error, 'A critical error occurred during batch upload.');
    writeProgressEvent(progressId, 'error', { status: 'error', message });
    endProgressStream(progressId);
  }
};
