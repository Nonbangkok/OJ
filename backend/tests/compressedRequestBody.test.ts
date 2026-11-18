import type { Express } from 'express';
import http from 'http';
import type { AddressInfo } from 'net';
import { once } from 'events';
import zlib from 'zlib';
import session from 'express-session';
import request from 'supertest';
import { parseRuntimeEnv } from '../config/env';

jest.mock('../db');

// body-parser < 2.4.0 (GHSA-27r3-jxmh-p828) leaves the decompression stream
// piped with no error listener once the compressed frame ends. Trailing bytes
// after the frame then raise an uncaught Z_DATA_ERROR, which terminates the
// Node process. The global JSON parser runs before routing and auth, so any
// anonymous request could trigger it.

type CreateApp = (options: {
  runtimeEnv: ReturnType<typeof parseRuntimeEnv>;
  sessionStore: session.Store;
}) => Express;

const baseEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://oj:secret@database:5432/oj',
  SECRET_KEY: 'test-secret',
  PGDATABASE: 'oj',
  PGUSER: 'oj',
  PGPASSWORD: 'secret',
  PGHOST: 'database',
  PGPORT: '5432',
};

const loadCreateApp = (): CreateApp => (require('../app') as { createApp: CreateApp }).createApp;

const postRaw = (port: number, path: string, headers: http.OutgoingHttpHeaders, body: Buffer): Promise<number> =>
  new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path, agent: false, headers }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body);
  });

describe('compressed request body with trailing bytes (GHSA-27r3-jxmh-p828)', () => {
  it('answers an anonymous gzip body followed by trailing bytes without crashing the process', async () => {
    const app = loadCreateApp()({
      runtimeEnv: parseRuntimeEnv({ ...baseEnv }),
      sessionStore: new session.MemoryStore(),
    });
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const { port } = server.address() as AddressInfo;

    try {
      // One valid gzip frame, a 0x00 byte (Node's gunzip ends the stream
      // there), then trailing bytes that reach the finished decoder.
      const body = Buffer.concat([
        zlib.gzipSync(Buffer.from('{"username":"a","password":"b"}')),
        Buffer.from([0x00]),
        Buffer.alloc(100 * 1024, 0x58),
      ]);

      const status = await postRaw(port, '/no-such-route', {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'Content-Length': body.length,
      }, body);
      expect(status).toBeGreaterThanOrEqual(400);

      // Let the trailing bytes reach the decoder. On body-parser < 2.4.0 the
      // decoder's error is uncaught here and fails this test (in production it
      // kills the backend process).
      await new Promise((resolve) => setTimeout(resolve, 300));

      const live = await request(server).get('/health/live');
      expect(live.status).toBe(200);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it('answers an unsupported Content-Encoding with 415 instead of a 500', async () => {
    const app = loadCreateApp()({
      runtimeEnv: parseRuntimeEnv({ ...baseEnv }),
      sessionStore: new session.MemoryStore(),
    });

    const res = await request(app)
      .post('/login')
      .set('Content-Type', 'application/json')
      .set('Content-Encoding', 'compress')
      .send('{"username":"a","password":"b"}');

    expect(res.status).toBe(415);
    expect(res.body).toEqual({ message: 'unsupported content encoding "compress"' });
  });

  it('runs a body-parser release that carries the trailing-bytes fix (>= 2.4.0)', () => {
    const { version } = require('body-parser/package.json') as { version: string };
    const [major, minor] = version.split('.').map(Number);
    expect(major > 2 || (major === 2 && minor >= 4)).toBe(true);
  });
});
