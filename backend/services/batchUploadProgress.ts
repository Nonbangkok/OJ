import { Request, Response } from 'express';
import { env } from '../config/env';
import { getErrorMessage } from '../utils/errorMessage';

// Server-sent-events hub for batch upload progress. The upload endpoint writes
// events keyed by progressId; the progress endpoint registers the client
// response that receives them.

const progressMap = new Map<string, Response>();
const progressHeartbeatMap = new Map<string, NodeJS.Timeout>();

const writeProgressEvent = (progressId: string, event: string, payload: unknown): void => {
  const clientResponse = progressMap.get(progressId);
  if (!clientResponse || clientResponse.writableEnded) {
    return;
  }
  clientResponse.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
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

  res.write(`event: initial\ndata: ${JSON.stringify({ message: 'Connected to batch upload progress stream.', progressId })}\n\n`);

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
