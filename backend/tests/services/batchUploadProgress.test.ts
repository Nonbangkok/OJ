import { EventEmitter } from 'events';
import { Request, Response } from 'express';
import { registerProgressClient, streamBatchUpload } from '../../services/batchUploadProgress';

const RETENTION_MS = 10 * 60 * 1000;

function responseHarness() {
  const writes: string[] = [];
  let writableEnded = false;
  const response = {
    writeHead: jest.fn(),
    write: jest.fn((chunk: string) => { writes.push(chunk); return true; }),
    end: jest.fn(() => { writableEnded = true; }),
  } as unknown as Response & { writes: string[] };
  Object.defineProperty(response, 'writes', { get: () => writes });
  Object.defineProperty(response, 'writableEnded', { get: () => writableEnded });
  return response;
}

function subscribe(progressId: string) {
  const request = new EventEmitter() as Request;
  request.headers = {};
  const response = responseHarness();
  registerProgressClient(progressId, request, response);
  request.emit('close');
  return response;
}

describe('batch upload progress replay', () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date('2026-09-29T12:00:00.000Z')));
  afterEach(() => jest.useRealTimers());

  it.each([
    ['complete', async () => ({ imported: 2 })],
    ['error', async () => { throw new Error('archive failed'); }],
  ])('replays progress followed by terminal %s to a late subscriber', async (terminal, upload) => {
    await streamBatchUpload(`late-${terminal}`, (onProgress) => {
      onProgress({ current: 2, total: 2 });
      return upload();
    });

    const response = subscribe(`late-${terminal}`);
    const replay = response.writes.join('');
    expect(replay.indexOf('event: progress')).toBeGreaterThanOrEqual(0);
    expect(replay.indexOf(`event: ${terminal}`)).toBeGreaterThan(replay.indexOf('event: progress'));
    expect(response.end).toHaveBeenCalledTimes(1);
  });

  it('expires retained progress and terminal events after ten minutes', async () => {
    await streamBatchUpload('expires', (onProgress) => {
      onProgress({ current: 1, total: 1 });
      return Promise.resolve({ imported: 1 });
    });
    const beforeExpiry = subscribe('expires');
    expect(beforeExpiry.writes.join('')).toContain('event: complete');
    jest.advanceTimersByTime(RETENTION_MS + 1);

    const response = subscribe('expires');
    const replay = response.writes.join('');
    expect(replay).toContain('event: initial');
    expect(replay).not.toContain('event: progress');
    expect(replay).not.toContain('event: complete');
  });

  it('continues writing the existing event format to a connected client', async () => {
    const request = new EventEmitter() as Request;
    request.headers = {};
    const response = responseHarness();
    registerProgressClient('live', request, response);
    await streamBatchUpload('live', (onProgress) => {
      onProgress({ current: 1, total: 1 });
      return Promise.resolve({ imported: 1 });
    });

    expect(response.writes.join('')).toContain('event: initial\ndata: {"message":"Connected to batch upload progress stream.","progressId":"live"}');
    expect(response.writes.join('')).toContain('event: progress\ndata: {"current":1,"total":1}');
    expect(response.writes.join('')).toContain('event: complete\ndata: {"status":"complete","message":"Batch upload process finished.","imported":1}');
    request.emit('close');
  });
});
