import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import { DB } from '../types/types';

const dialect = new PostgresDialect({
    pool: new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 10,
        // Add SSL for production or Neon connections
        ssl: process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('neon.tech')
            ? { rejectUnauthorized: false }
            : false,
    }),
});

export const db = new Kysely<DB>({
    dialect,
});
