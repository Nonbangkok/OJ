import { z } from 'zod';
import path from 'node:path';

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).optional(),
  PORT: z.string().optional(),
  DATABASE_URL: z.string().min(1),
  SECRET_KEY: z.string().min(1),
  PGDATABASE: z.string().min(1),
  PGUSER: z.string().min(1),
  PGPASSWORD: z.string().min(1),
  PGHOST: z.string().min(1),
  PGPORT: z.string().min(1),
  COOKIE_SECURE: z.enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  COOKIE_DOMAIN: z.preprocess(
    (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
    z.string().trim().min(1).optional(),
  ),
  CORS_ORIGINS: z.string()
    .default('')
    .transform((value) => value.split(',').map((origin) => origin.trim()).filter(Boolean))
    .pipe(z.array(z.string().url())),
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  AUTHORING_JOBS_DIR: z.string().default('').refine(value => value === ''
    || (path.isAbsolute(value) && path.resolve(value) !== path.parse(value).root)),
});

export const parseRuntimeEnv = (input: NodeJS.ProcessEnv) => {
  const envWithTestFallbacks = input.NODE_ENV === 'test'
    ? {
        ...input,
        DATABASE_URL: input.DATABASE_URL ?? 'postgres://localhost:5432/oj_test',
        SECRET_KEY: input.SECRET_KEY ?? 'test-secret',
        PGDATABASE: input.PGDATABASE ?? 'oj_test',
        PGUSER: input.PGUSER ?? 'postgres',
        PGPASSWORD: input.PGPASSWORD ?? 'postgres',
        PGHOST: input.PGHOST ?? 'localhost',
        PGPORT: input.PGPORT ?? '5432',
      }
    : input;

  const parsedEnv = baseEnvSchema.safeParse(envWithTestFallbacks);

  if (!parsedEnv.success) {
    const invalidKeys = parsedEnv.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`Invalid environment configuration: ${invalidKeys}`);
  }

  // AUTH-007: refuse to boot in production with insecure session cookies.
  // COOKIE_SECURE defaults to false (the dev stack runs plain HTTP), so a
  // production deployment that forgets to set it would hand out cookies the
  // browser happily transmits over plain HTTP. Fail loudly at startup
  // instead of silently issuing insecure sessions.
  if (parsedEnv.data.NODE_ENV === 'production' && !parsedEnv.data.COOKIE_SECURE) {
    throw new Error(
      'Invalid environment configuration: COOKIE_SECURE must be "true" when NODE_ENV=production '
        + '(session cookies would otherwise be transmitted over plain HTTP). '
        + 'Set COOKIE_SECURE=true (or NODE_ENV=development for local HTTP stacks).',
    );
  }

  return parsedEnv.data;
};

export const env = parseRuntimeEnv(process.env);
