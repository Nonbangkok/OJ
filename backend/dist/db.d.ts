import pg from 'pg';
declare const pool: pg.Pool;
export declare const query: (text: string, params?: any[]) => Promise<pg.QueryResult<any>>;
export { pool };
