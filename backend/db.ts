import pg from 'pg';
import { env } from './config/env';
const { Pool } = pg;

// When running in Docker, Docker Compose injects the DATABASE_URL directly.
const pool = new Pool({
    connectionString: env.DATABASE_URL,
    // When connecting container-to-container on a private Docker network like in this
    // docker-compose setup, SSL is not necessary as the network is isolated.
    // The official Postgres image doesn't enable SSL by default.
    ssl: false,
});

export const query = <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params?: unknown[]) => pool.query<T>(text, params);
export { pool };
