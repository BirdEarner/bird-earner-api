import 'dotenv/config';
import { db } from '../lib/db';

async function checkJobStatus() {
    try {
        console.log('--- Inspecting Jobs & Chat Threads ---');
        const jobs = await db
            .selectFrom('jobs')
            .select(['id', 'jobTitle', 'jobStatus', 'clientId', 'assignedFreelancerId', 'createdBy', 'updatedAt'])
            .orderBy('updatedAt', 'desc')
            .limit(10)
            .execute();

        console.log('Recent 10 Jobs:');
        for (const j of jobs) {
            console.log(j);
        }

        const blocked = await db
            .selectFrom('blockedUsers')
            .selectAll()
            .execute();
        console.log('Current Blocked Users count:', blocked.length);
        console.log(blocked);

    } catch (err) {
        console.error(err);
    } finally {
        process.exit(0);
    }
}

checkJobStatus();
