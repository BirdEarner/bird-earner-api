import 'dotenv/config';
import { db } from '../lib/db';
import { sql } from 'kysely';

async function applyMigrationColumns() {
    console.log('Applying missing columns to database...');
    await sql`
        ALTER TABLE "freelancers"
        ADD COLUMN IF NOT EXISTS "cancellationStrikes" INT DEFAULT 0,
        ADD COLUMN IF NOT EXISTS "cooldownExpiresAt" TIMESTAMP;
    `.execute(db);
    console.log('✅ Successfully applied cancellationStrikes and cooldownExpiresAt to freelancers table.');
}

applyMigrationColumns()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
