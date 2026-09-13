type ParsedRuntimeEnv = {
  COOKIE_SECURE: boolean;
  COOKIE_DOMAIN?: string;
  CORS_ORIGINS: string[];
  TRUST_PROXY: number;
};

type EnvModule = {
  parseRuntimeEnv?: (input: NodeJS.ProcessEnv) => ParsedRuntimeEnv;
};

const requiredEnv: NodeJS.ProcessEnv = {
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://oj:secret@database:5432/oj',
  SECRET_KEY: 'test-secret',
  PGDATABASE: 'oj',
  PGUSER: 'oj',
  PGPASSWORD: 'secret',
  PGHOST: 'database',
  PGPORT: '5432',
};

describe('runtime environment configuration', () => {
  const envModule = require('../../config/env') as EnvModule;

  it('uses local-safe cookie and CORS defaults', () => {
    expect(envModule.parseRuntimeEnv).toBeInstanceOf(Function);

    const parsed = envModule.parseRuntimeEnv!({ ...requiredEnv });

    expect(parsed.COOKIE_SECURE).toBe(false);
    expect(parsed.COOKIE_DOMAIN).toBeUndefined();
    expect(parsed.CORS_ORIGINS).toEqual([]);
    expect(parsed.TRUST_PROXY).toBe(1);
  });

  it('normalizes explicit production proxy, cookie, and CORS settings', () => {
    const parsed = envModule.parseRuntimeEnv!({
      ...requiredEnv,
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
      COOKIE_DOMAIN: 'nonbangkokgrader.com',
      CORS_ORIGINS: ' https://www.nonbangkokgrader.com,https://upload.nonbangkokgrader.com ',
      TRUST_PROXY: '2',
    });

    expect(parsed.COOKIE_SECURE).toBe(true);
    expect(parsed.COOKIE_DOMAIN).toBe('nonbangkokgrader.com');
    expect(parsed.CORS_ORIGINS).toEqual([
      'https://www.nonbangkokgrader.com',
      'https://upload.nonbangkokgrader.com',
    ]);
    expect(parsed.TRUST_PROXY).toBe(2);
  });

  it('rejects ambiguous boolean values instead of silently enabling cookies', () => {
    expect(() => envModule.parseRuntimeEnv!({
      ...requiredEnv,
      COOKIE_SECURE: 'yes',
    })).toThrow(/COOKIE_SECURE/);
  });

  it('rejects invalid CORS origins', () => {
    expect(() => envModule.parseRuntimeEnv!({
      ...requiredEnv,
      CORS_ORIGINS: 'not-a-url',
    })).toThrow(/CORS_ORIGINS/);
  });
});
