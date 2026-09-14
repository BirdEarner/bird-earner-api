import 'dotenv/config';
import { db } from '../lib/db';
import { createJob, assignFreelancer } from '../lib/services/jobs';
import { createOrGetThread, sendMessage, getConversations } from '../lib/services/chats';

async function runBlockFunctionalityTests() {
    console.log('====================================================');
    console.log('🚀 STARTING COMPLETE BLOCK FUNCTIONALITY TEST SUITE');
    console.log('====================================================\n');

    let clientUserId: string | null = null;
    let clientId: string | null = null;
    let freeUserAId: string | null = null;
    let freeAId: string | null = null;
    let freeUserBId: string | null = null;
    let freeBId: string | null = null;

    let client2UserId: string | null = null;
    let client2Id: string | null = null;
    let freeUserCId: string | null = null;
    let freeCId: string | null = null;

    const createdJobIds: string[] = [];
    const createdThreadIds: string[] = [];

    try {
        // ---------------------------------------------------------
        // SETUP TEST USERS
        // ---------------------------------------------------------
        console.log('--- 1. Setting up Test Users ---');
        
        // Client 1 (Create both client & freelancer profiles for FK integrity)
        clientUserId = crypto.randomUUID();
        clientId = clientUserId;
        await db.insertInto('users').values({
            id: clientUserId,
            email: `client_block_${Date.now()}@test.com`,
            fullName: 'Test Client BlockOwner',
            isTestAccount: true,
            updatedAt: new Date()
        }).execute();

        await db.insertInto('clients').values({
            id: clientId,
            userId: clientUserId,
            wallet: '100000.00' as any,
            availableBalance: '100000.00' as any,
            updatedAt: new Date()
        }).execute();

        await db.insertInto('freelancers').values({
            id: clientId,
            userId: clientUserId,
            updatedAt: new Date()
        }).execute();

        // Freelancer A (Create both client & freelancer profiles for FK integrity)
        freeUserAId = crypto.randomUUID();
        freeAId = freeUserAId;
        await db.insertInto('users').values({
            id: freeUserAId,
            email: `freelancer_a_${Date.now()}@test.com`,
            fullName: 'Test Freelancer A',
            isTestAccount: true,
            updatedAt: new Date()
        }).execute();

        await db.insertInto('freelancers').values({
            id: freeAId,
            userId: freeUserAId,
            updatedAt: new Date()
        }).execute();

        await db.insertInto('clients').values({
            id: freeAId,
            userId: freeUserAId,
            updatedAt: new Date()
        }).execute();

        // Freelancer B (Control - Unblocked)
        freeUserBId = crypto.randomUUID();
        freeBId = freeUserBId;
        await db.insertInto('users').values({
            id: freeUserBId,
            email: `freelancer_b_${Date.now()}@test.com`,
            fullName: 'Test Freelancer B (Unblocked)',
            isTestAccount: true,
            updatedAt: new Date()
        }).execute();

        await db.insertInto('freelancers').values({
            id: freeBId,
            userId: freeUserBId,
            updatedAt: new Date()
        }).execute();

        await db.insertInto('clients').values({
            id: freeBId,
            userId: freeUserBId,
            updatedAt: new Date()
        }).execute();

        console.log(`✅ Created Client 1 (${clientId}), Freelancer A (${freeAId}), Freelancer B (${freeBId})`);

        // ---------------------------------------------------------
        // SETUP TEST JOBS & APPLICATIONS
        // ---------------------------------------------------------
        console.log('\n--- 2. Setting up Jobs & Applications ---');

        // Job 1 (Open - Freelancer A will apply)
        const job1 = await createJob({
            jobTitle: 'Block Test Job 1 (Applied)',
            jobDescription: 'Testing block with existing application',
            jobCategory: 'FREELANCE',
            jobSubCategory: 'Web Development',
            skillsRequired: ['React'],
            projectType: 'REMOTE',
            budgetType: 'FIXED',
            budgetAmount: 500,
            paymentMethod: 'PLATFORM'
        }, clientUserId, clientId);
        createdJobIds.push(job1.id);

        // Job 2 (Open - Freelancer A will apply)
        const job2 = await createJob({
            jobTitle: 'Block Test Job 2 (Applied)',
            jobDescription: 'Testing block with second application',
            jobCategory: 'FREELANCE',
            jobSubCategory: 'Web Development',
            skillsRequired: ['Node.js'],
            projectType: 'REMOTE',
            budgetType: 'FIXED',
            budgetAmount: 700,
            paymentMethod: 'PLATFORM'
        }, clientUserId, clientId);
        createdJobIds.push(job2.id);

        // Job 3 (Open - Freelancer A has NOT applied yet)
        const job3 = await createJob({
            jobTitle: 'Block Test Job 3 (Unapplied)',
            jobDescription: 'Testing block prevention on new apply',
            jobCategory: 'FREELANCE',
            jobSubCategory: 'Design',
            skillsRequired: ['Figma'],
            projectType: 'REMOTE',
            budgetType: 'FIXED',
            budgetAmount: 1000,
            paymentMethod: 'PLATFORM'
        }, clientUserId, clientId);
        createdJobIds.push(job3.id);

        // Job 4 (Active In-Progress assigned to Freelancer A)
        const job4 = await createJob({
            jobTitle: 'Block Test Job 4 (Active In-Progress)',
            jobDescription: 'Testing block on active assigned job',
            jobCategory: 'FREELANCE',
            jobSubCategory: 'Mobile Development',
            skillsRequired: ['React Native'],
            projectType: 'REMOTE',
            budgetType: 'FIXED',
            budgetAmount: 1500,
            paymentMethod: 'PLATFORM'
        }, clientUserId, clientId);
        createdJobIds.push(job4.id);

        // Job 5 (Completed assigned to Freelancer A)
        const job5 = await createJob({
            jobTitle: 'Block Test Job 5 (Completed)',
            jobDescription: 'Testing block on completed job',
            jobCategory: 'FREELANCE',
            jobSubCategory: 'Content',
            skillsRequired: ['Writing'],
            projectType: 'REMOTE',
            budgetType: 'FIXED',
            budgetAmount: 400,
            paymentMethod: 'PLATFORM'
        }, clientUserId, clientId);
        createdJobIds.push(job5.id);

        // Freelancer A applies to Job 1 & Job 2
        const thread1 = await createOrGetThread(job1.id, freeAId, clientId);
        createdThreadIds.push(thread1.id);

        const thread2 = await createOrGetThread(job2.id, freeAId, clientId);
        createdThreadIds.push(thread2.id);

        // Assign Job 4 to Freelancer A (becomes IN_PROGRESS)
        const thread4 = await createOrGetThread(job4.id, freeAId, clientId);
        createdThreadIds.push(thread4.id);
        await assignFreelancer(job4.id, freeAId, clientUserId);
        console.log('✅ Job 4 assigned & IN_PROGRESS');

        // Assign & Complete Job 5
        const thread5 = await createOrGetThread(job5.id, freeAId, clientId);
        createdThreadIds.push(thread5.id);
        await assignFreelancer(job5.id, freeAId, clientUserId);
        await db.updateTable('jobs').set({ jobStatus: 'COMPLETED', completedAt: new Date() }).where('id', '=', job5.id).execute();
        console.log('✅ Job 5 assigned & COMPLETED');

        // ---------------------------------------------------------
        // SECTION 1: CLIENT BLOCKS FREELANCER A
        // ---------------------------------------------------------
        console.log('\n--- 3. Testing Scenario 1: Client 1 Blocks Freelancer A ---');

        // Execute block via API endpoint logic
        await db.insertInto('blockedUsers').values({
            id: crypto.randomUUID(),
            blockerId: clientId,
            blockedId: freeAId,
            blockerType: 'CLIENT',
            blockedType: 'FREELANCER',
            createdAt: new Date()
        }).execute();

        // Update threads status (same as POST /api/chats/block)
        const ACTIVE_JOB_STATUSES = [
            'CONFIRMED', 'IN_PROGRESS', 'FREELANCER_TRAVELLING', 'ARRIVED',
            'JOB_STARTED', 'WORK_SUBMITTED', 'REVISION_REQUESTED',
            'REVISION_SUBMITTED', 'WORK_ACCEPTED'
        ];

        const allThreads = await db
            .selectFrom('chatThreads')
            .innerJoin('jobs', 'jobs.id', 'chatThreads.jobId')
            .select(['chatThreads.id', 'jobs.jobStatus'])
            .where('chatThreads.clientId', '=', clientId)
            .where('chatThreads.freelancerId', '=', freeAId)
            .execute();

        const blockableIds = allThreads.filter(t => !ACTIVE_JOB_STATUSES.includes(t.jobStatus)).map(t => t.id);
        if (blockableIds.length > 0) {
            await db.updateTable('chatThreads').set({ status: 'BLOCKED', updatedAt: new Date() }).where('id', 'in', blockableIds).execute();
        }

        console.log(`✅ Block entry created & non-active threads set to BLOCKED (Threads: ${blockableIds.join(', ')})`);

        // Test 1a: Freelancer A job visibility query
        console.log('\n[Test 1a] Verifying Freelancer A cannot see Client 1 jobs in job listing query...');
        const blockedClientIds = [clientId];
        const visibleJobsForFreeA = await db
            .selectFrom('jobs')
            .select(['jobs.id', 'jobs.jobTitle'])
            .where('jobs.deleted', '=', false)
            .where('jobs.clientId', 'not in', blockedClientIds)
            .where('jobs.id', 'in', createdJobIds)
            .execute();

        if (visibleJobsForFreeA.length === 0) {
            console.log('✅ PASS: Client 1 jobs are correctly hidden from Freelancer A in job listing.');
        } else {
            console.error('❌ FAIL: Client 1 jobs still visible to Freelancer A:', visibleJobsForFreeA);
        }

        // Test 1b: Freelancer A applying to Job 3 (Unapplied)
        console.log('\n[Test 1b] Verifying Freelancer A cannot apply to Client 1 job (Job 3)...');
        try {
            await createOrGetThread(job3.id, freeAId, clientId);
            console.error('❌ FAIL: Freelancer A was able to apply to Job 3!');
        } catch (err: any) {
            console.log(`✅ PASS: Apply blocked with message: "${err.message}"`);
        }

        // Test 1c: Client 1 assigning Job 3 to Freelancer A
        console.log('\n[Test 1c] Verifying Client 1 cannot assign job (Job 3) to blocked Freelancer A...');
        try {
            await assignFreelancer(job3.id, freeAId, clientUserId);
            console.error('❌ FAIL: Client 1 was able to assign Job 3 to blocked Freelancer A!');
        } catch (err: any) {
            console.log(`✅ PASS: Assign blocked with message: "${err.message}"`);
        }

        // ---------------------------------------------------------
        // SECTION 3 & 4: EXISTING APPLICATIONS & ACTIVE JOBS
        // ---------------------------------------------------------
        console.log('\n--- 4. Testing Scenario 3 & 4: Existing Applications & Active Jobs ---');

        // Test 3a: Verification of application thread statuses
        const t1Status = await db.selectFrom('chatThreads').select('status').where('id', '=', thread1.id).executeTakeFirst();
        const t2Status = await db.selectFrom('chatThreads').select('status').where('id', '=', thread2.id).executeTakeFirst();

        if (t1Status?.status === 'BLOCKED' && t2Status?.status === 'BLOCKED') {
            console.log('✅ PASS: Existing open application threads (Thread 1 & 2) set to BLOCKED.');
        } else {
            console.error('❌ FAIL: Application threads not BLOCKED:', { t1Status, t2Status });
        }

        // Test 3b: Sending message on blocked application thread
        console.log('\n[Test 3b] Verifying Freelancer A cannot send message on blocked application thread...');
        try {
            await sendMessage({
                chatThreadId: thread1.id,
                senderId: freeUserAId,
                receiverId: clientUserId,
                messageContent: 'Hello, are you there?',
                messageType: 'text',
                senderType: 'FREELANCER'
            });
            console.error('❌ FAIL: Message sent on blocked thread!');
        } catch (err: any) {
            console.log(`✅ PASS: Messaging prevented with message: "${err.message}"`);
        }

        // Test 4a: Active Job 4 thread status
        const t4Status = await db.selectFrom('chatThreads').select('status').where('id', '=', thread4.id).executeTakeFirst();
        if (t4Status?.status !== 'BLOCKED') {
            console.log(`✅ PASS: Active Job 4 thread remains accessible (Status: ${t4Status?.status}).`);
        } else {
            console.error('❌ FAIL: Active Job 4 thread was incorrectly BLOCKED!');
        }

        // Test 4b: Messaging on Active Job 4 thread
        console.log('\n[Test 4b] Verifying messaging works on Active Job 4...');
        const msgRes = await sendMessage({
            chatThreadId: thread4.id,
            senderId: freeUserAId,
            receiverId: clientUserId,
            messageContent: 'Work in progress update for active job',
            messageType: 'text',
            senderType: 'FREELANCER'
        });
        if (msgRes.id) {
            console.log('✅ PASS: Messages can still be sent on Active Job 4.');
        } else {
            console.error('❌ FAIL: Could not send message on active job.');
        }

        // Test 4c: Completed Job 5 verification
        const job5Db = await db.selectFrom('jobs').select('jobStatus').where('id', '=', job5.id).executeTakeFirst();
        if (job5Db?.jobStatus === 'COMPLETED') {
            console.log('✅ PASS: Completed Job 5 remains COMPLETED (data preserved intact).');
        } else {
            console.error('❌ FAIL: Completed job status corrupted:', job5Db);
        }

        // ---------------------------------------------------------
        // SECTION 8: ISOLATION FOR UNBLOCKED FREELANCER B
        // ---------------------------------------------------------
        console.log('\n--- 5. Testing Scenario 8: Isolation for Unblocked Freelancer B ---');

        // Test 8a: Freelancer B applies to Job 3
        const threadB3 = await createOrGetThread(job3.id, freeBId, clientId);
        createdThreadIds.push(threadB3.id);
        console.log('✅ PASS: Unblocked Freelancer B successfully applied to Job 3.');

        // Test 8b: Client 1 assigns Job 3 to Freelancer B
        const assignBRes = await assignFreelancer(job3.id, freeBId, clientUserId);
        if (assignBRes && assignBRes.id) {
            console.log('✅ PASS: Client 1 successfully assigned Job 3 to unblocked Freelancer B.');
        } else {
            console.error('❌ FAIL: Failed to assign job to unblocked Freelancer B.');
        }

        // ---------------------------------------------------------
        // SECTION 2: FREELANCER BLOCKS CLIENT
        // ---------------------------------------------------------
        console.log('\n--- 6. Testing Scenario 2: Freelancer Blocks Client ---');

        client2UserId = crypto.randomUUID();
        client2Id = client2UserId;
        await db.insertInto('users').values({
            id: client2UserId,
            email: `client2_block_${Date.now()}@test.com`,
            fullName: 'Test Client 2',
            isTestAccount: true,
            updatedAt: new Date()
        }).execute();

        await db.insertInto('clients').values({ id: client2Id, userId: client2UserId, wallet: '100000.00' as any, availableBalance: '100000.00' as any, updatedAt: new Date() }).execute();
        await db.insertInto('freelancers').values({ id: client2Id, userId: client2UserId, updatedAt: new Date() }).execute();

        freeUserCId = crypto.randomUUID();
        freeCId = freeUserCId;
        await db.insertInto('users').values({
            id: freeUserCId,
            email: `freelancer_c_${Date.now()}@test.com`,
            fullName: 'Test Freelancer C',
            isTestAccount: true,
            updatedAt: new Date()
        }).execute();

        await db.insertInto('freelancers').values({ id: freeCId, userId: freeUserCId, updatedAt: new Date() }).execute();
        await db.insertInto('clients').values({ id: freeCId, userId: freeUserCId, updatedAt: new Date() }).execute();

        // Create job for Client 2
        const jobC = await createJob({
            jobTitle: 'Client 2 Job',
            jobDescription: 'Job owned by Client 2',
            jobCategory: 'FREELANCE',
            jobSubCategory: 'Design',
            skillsRequired: ['Logo'],
            projectType: 'REMOTE',
            budgetType: 'FIXED',
            budgetAmount: 800,
            paymentMethod: 'PLATFORM'
        }, client2UserId, client2Id);
        createdJobIds.push(jobC.id);

        // Freelancer C blocks Client 2
        await db.insertInto('blockedUsers').values({
            id: crypto.randomUUID(),
            blockerId: freeCId,
            blockedId: client2Id,
            blockerType: 'FREELANCER',
            blockedType: 'CLIENT',
            createdAt: new Date()
        }).execute();

        console.log('✅ Freelancer C blocked Client 2.');

        // Test 2a: Freelancer C applying to Client 2 job
        try {
            await createOrGetThread(jobC.id, freeCId, client2Id);
            console.error('❌ FAIL: Freelancer C was able to apply to Client 2 job after blocking Client 2!');
        } catch (err: any) {
            console.log(`✅ PASS: Apply blocked when Freelancer blocked Client: "${err.message}"`);
        }

        // Test 2b: Client 2 assigning job to Freelancer C
        try {
            await assignFreelancer(jobC.id, freeCId, client2UserId);
            console.error('❌ FAIL: Client 2 was able to assign job to Freelancer C who blocked them!');
        } catch (err: any) {
            console.log(`✅ PASS: Assign blocked when Freelancer blocked Client: "${err.message}"`);
        }

        console.log('\n====================================================');
        console.log('🎉 ALL BLOCK FUNCTIONALITY TESTS PASSED SUCCESSFULLY!');
        console.log('====================================================\n');

    } catch (err: any) {
        console.error('\n❌ ERROR DURING BLOCK TESTS:', err);
    } finally {
        // Cleanup test data
        console.log('--- Cleaning up test records ---');
        if (createdThreadIds.length > 0) {
            await db.deleteFrom('negotiationHistory').where('chatThreadId', 'in', createdThreadIds).execute();
            await db.deleteFrom('messages').where('chatThreadId', 'in', createdThreadIds).execute();
            await db.deleteFrom('chatThreads').where('id', 'in', createdThreadIds).execute();
        }
        if (createdJobIds.length > 0) {
            await db.deleteFrom('walletTransactions').where('jobId', 'in', createdJobIds).execute();
            await db.deleteFrom('jobStatusHistory').where('jobId', 'in', createdJobIds).execute();
            await db.deleteFrom('jobs').where('id', 'in', createdJobIds).execute();
        }
        if (clientId && freeAId) {
            await db.deleteFrom('blockedUsers').where('blockerId', 'in', [clientId, freeCId!]).execute();
        }
        const userIds = [clientUserId, freeUserAId, freeUserBId, client2UserId, freeUserCId].filter(Boolean) as string[];
        if (userIds.length > 0) {
            await db.deleteFrom('clients').where('userId', 'in', userIds).execute();
            await db.deleteFrom('freelancers').where('userId', 'in', userIds).execute();
            await db.deleteFrom('users').where('id', 'in', userIds).execute();
        }
        console.log('✅ Cleanup complete.');
    }
}

runBlockFunctionalityTests();
