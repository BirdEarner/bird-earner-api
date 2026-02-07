import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { DB } from '../types/types';

const dialect = new PostgresDialect({
    pool: new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10,
        // Add SSL if needed based on environment
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    }),
});

export const db = new Kysely<DB>({
    dialect,
});
