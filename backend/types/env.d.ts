declare namespace NodeJS {
    interface ProcessEnv {
        NODE_ENV?: 'development' | 'test' | 'production';
        PORT?: string;
        DATABASE_URL: string;
        SECRET_KEY: string;
        PGDATABASE: string;
        PGUSER: string;
        PGPASSWORD: string;
        PGHOST: string;
        PGPORT: string;
    }
}
