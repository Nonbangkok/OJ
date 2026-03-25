import { z } from 'zod';

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
});

const envWithTestFallbacks = process.env.NODE_ENV === 'test'
  ? {
      ...process.env,
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://localhost:5432/oj_test',
      SECRET_KEY: process.env.SECRET_KEY ?? 'test-secret',
      PGDATABASE: process.env.PGDATABASE ?? 'oj_test',
      PGUSER: process.env.PGUSER ?? 'postgres',
      PGPASSWORD: process.env.PGPASSWORD ?? 'postgres',
      PGHOST: process.env.PGHOST ?? 'localhost',
      PGPORT: process.env.PGPORT ?? '5432',
    }
  : process.env;

const parsedEnv = baseEnvSchema.safeParse(envWithTestFallbacks);

if (!parsedEnv.success) {
  const missingKeys = parsedEnv.error.issues.map((issue) => issue.path.join('.')).join(', ');
  throw new Error(`Invalid environment configuration: ${missingKeys}`);
}

export const env = parsedEnv.data;
