import 'dotenv/config';
import { db } from '../lib/db';
import { createOrGetThread } from '../lib/services/chats';

async function testConcurrentThreadCreation() {
    console.log('=========================================================');
    console.log('🧪 TESTING CONCURRENT CHAT THREAD CREATION (RACE CONDITION)');
    console.log('=========================================================');

    const clientUser = await db.selectFrom('users').innerJoin('clients', 'clients.userId', 'users.id').select(['users.id as userId', 'clients.id as clientId']).executeTakeFirst();
    const freelancerUser = await db.selectFrom('users').innerJoin('freelancers', 'freelancers.userId', 'users.id').select(['users.id as userId', 'freelancers.id as freelancerId']).executeTakeFirst();

    if (!clientUser || !freelancerUser) {
        console.error('Test users not found');
        process.exit(1);
    }

    // Reset cooldown or negative withdrawable balance for test freelancer if set
    await db.updateTable('freelancers').set({ cooldownExpiresAt: null, withdrawableAmount: '0.00' }).where('id', '=', freelancerUser.freelancerId).execute();

    const jobId = crypto.randomUUID();
    const now = new Date();

    // Create active job
    await db.insertInto('jobs').values({
        id: jobId,
        jobTitle: 'Concurrent Thread Race Condition Test Job',
        jobDescription: 'Testing duplicate key handling',
        jobCategory: 'General',
        jobSubCategory: 'General',
        skillsRequired: JSON.stringify([]),
        projectType: 'on-site',
        budgetType: 'fixed',
        budgetAmount: '1000.00',
        clientId: clientUser.clientId,
        paymentMethod: 'PLATFORM',
        jobStatus: 'OPEN',
        createdAt: now,
        updatedAt: now,
    }).execute();

    console.log('Simulating 5 simultaneous requests to createOrGetThread...');

    // Run 5 simultaneous calls to createOrGetThread for the same (jobId, freelancerId, clientId)
    const results = await Promise.all([
        createOrGetThread(jobId, freelancerUser.freelancerId, clientUser.clientId),
        createOrGetThread(jobId, freelancerUser.freelancerId, clientUser.clientId),
        createOrGetThread(jobId, freelancerUser.freelancerId, clientUser.clientId),
        createOrGetThread(jobId, freelancerUser.freelancerId, clientUser.clientId),
        createOrGetThread(jobId, freelancerUser.freelancerId, clientUser.clientId),
    ]);

    console.log(`✅ All ${results.length} concurrent requests resolved successfully!`);
    console.log(`Thread ID: ${results[0].id}`);

    const uniqueIds = new Set(results.map(r => r.id));
    if (uniqueIds.size !== 1) {
        throw new Error(`Expected all concurrent calls to return the exact same thread ID, but got ${uniqueIds.size} different IDs.`);
    }

    console.log('=========================================================');
    console.log('🎉 CONCURRENT CHAT THREAD CREATION TEST PASSED!');
    console.log('=========================================================');
    process.exit(0);
}

testConcurrentThreadCreation().catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
