import { logger } from '../../utils/logger';

describe('logger', () => {
  const originalEnv = process.env.NODE_ENV;

  let logSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    // tests/setup.ts already mocked console.error/warn in its beforeEach and
    // will clearAllMocks() — install fresh spies afterwards so call counts
    // belong to this test alone.
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    process.env.NODE_ENV = originalEnv;
  });

  describe('non-production output', () => {
    it('writes a prefixed human-readable line', () => {
      process.env.NODE_ENV = 'development';
      logger.info('contest started', { contestId: 7 });

      expect(logSpy).toHaveBeenCalledWith('[info] contest started contestId=7');
    });

    it('omits the fields suffix when no fields are given', () => {
      process.env.NODE_ENV = 'test';
      logger.warn('scheduler tick');

      expect(warnSpy).toHaveBeenCalledWith('[warn] scheduler tick');
    });

    it('routes error to console.error', () => {
      process.env.NODE_ENV = 'test';
      logger.error('judge failed', { submissionId: 3 });

      expect(errorSpy).toHaveBeenCalledWith('[error] judge failed submissionId=3');
    });

    it('serialises Error fields to the stack', () => {
      process.env.NODE_ENV = 'test';
      const boom = new Error('kaboom');
      logger.error('judge failed', { err: boom });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('[error] judge failed err=Error: kaboom')
      );
    });

    it('serialises object fields as JSON', () => {
      process.env.NODE_ENV = 'test';
      logger.info('migrated', { counts: { moved: 2, kept: 0 } });

      expect(logSpy).toHaveBeenCalledWith('[info] migrated counts={"moved":2,"kept":0}');
    });

    it('emits debug in non-production', () => {
      process.env.NODE_ENV = 'development';
      logger.debug('noisy detail');

      expect(logSpy).toHaveBeenCalledWith('[debug] noisy detail');
    });

    it('suppresses debug in production', () => {
      process.env.NODE_ENV = 'production';
      logger.debug('noisy detail');

      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  describe('production output', () => {
    it('writes single-line JSON with ts, level, and msg', () => {
      process.env.NODE_ENV = 'production';
      logger.info('contest started', { contestId: 7 });

      const [line] = logSpy.mock.calls[0];
      const parsed = JSON.parse(line as string);
      expect(parsed.level).toBe('info');
      expect(parsed.msg).toBe('contest started');
      expect(parsed.contestId).toBe(7);
      expect(typeof parsed.ts).toBe('string');
    });

    it('routes warn/error levels to the matching console method', () => {
      process.env.NODE_ENV = 'production';
      logger.warn('degraded', { what: 'db' });
      logger.error('down');

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(() => JSON.parse(warnSpy.mock.calls[0][0] as string)).not.toThrow();
      expect(() => JSON.parse(errorSpy.mock.calls[0][0] as string)).not.toThrow();
    });
  });
});
