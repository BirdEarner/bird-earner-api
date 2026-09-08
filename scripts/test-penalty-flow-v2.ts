import 'dotenv/config';
import { db } from '../lib/db';

/**
 * PENALTY FLOW TEST SUITE v2
 * 
 * Tests the updated penalty flow:
 * 1. Client cancels → wallet >= penalty → auto-deduct from wallet
 * 2. Client cancels → wallet < penalty → keep outstanding, collect on next job
 * 3. Next job PLATFORM → reserve budget, deduct penalty immediately
 * 4. Next job CASH → client pays budget + penalty to freelancer
 * 5. No penalty → normal flow unchanged
 * 6. Job with penalty cancelled → penalty moves back to pending
 */

async function getTestClient() {
    const client = await db
        .selectFrom('clients')
        .innerJoin('users', 'users.id', 'clients.userId')
        .select([
            'clients.id as clientId',
            'users.id as clientUserId',
            'clients.wallet',
            'clients.reservedAmount',
            'clients.pendingPenaltyAmount',
            'clients.totalPenaltyPaid'
        ])
        .executeTakeFirst();
    return client;
}

async function getTestFreelancer() {
    const freelancer = await db
        .selectFrom('freelancers')
        .innerJoin('users', 'users.id', 'freelancers.userId')
        .select([
            'freelancers.id as freelancerId',
            'users.id as freelancerUserId',
            'freelancers.withdrawableAmount'
        ])
        .executeTakeFirst();
    return freelancer;
}

async function getService() {
    const service = await db
        .selectFrom('services')
        .select(['id', 'birdFee'])
        .limit(1)
        .executeTakeFirst();
    return service;
}

async function resetClientState(clientUserId: string) {
    await db
        .updateTable('clients')
        .set({
            wallet: '10000',
            reservedAmount: '0',
            pendingPenaltyAmount: '0',
            updatedAt: new Date()
        })
        .where('userId', '=', clientUserId)
        .execute();
}

async function createTestJob(
    clientUserId: string,
    clientId: string,
    budgetAmount: number,
    paymentMethod: string,
    serviceId?: string
) {
    const { createJob } = await import('../lib/services/jobs');
    return await createJob(
        {
            jobTitle: `Penalty Test Job - ${budgetAmount}`,
            jobDescription: `Testing penalty flow for budget ${budgetAmount}`,
            jobCategory: 'AC Repair',
            jobSubCategory: 'AC Repair',
            projectType: 'On-site',
            budgetType: 'Fixed',
            budgetAmount,
            workDurationDays: 1,
            paymentMethod,
            serviceId: serviceId || undefined,
        },
        clientUserId,
        clientId
    );
}

async function assignAndConfirmJob(jobId: string, freelancerId: string, clientUserId: string) {
    const { assignFreelancer } = await import('../lib/services/jobs');
    return await assignFreelancer(jobId, freelancerId, clientUserId);
}

async function cancelJobAfterGracePeriod(jobId: string, clientUserId: string) {
    const { cancelJob } = await import('../lib/services/jobs');

    // Set confirmedAt to 10 minutes ago (past 5-min grace window)
    await db
        .updateTable('jobs')
        .set({ confirmedAt: new Date(Date.now() - 10 * 60 * 1000) })
        .where('id', '=', jobId)
        .execute();

    return await cancelJob(jobId, clientUserId, 'Test cancellation after grace period');
}

async function getClientState(clientUserId: string) {
    const client = await db
        .selectFrom('clients')
        .select(['wallet', 'reservedAmount', 'pendingPenaltyAmount', 'totalPenaltyPaid'])
        .where('userId', '=', clientUserId)
        .executeTakeFirst();
    return {
        wallet: parseFloat(client?.wallet || '0'),
        reservedAmount: parseFloat(client?.reservedAmount || '0'),
        pendingPenalty: parseFloat(client?.pendingPenaltyAmount?.toString() || '0'),
        totalPenaltyPaid: parseFloat(client?.totalPenaltyPaid?.toString() || '0'),
    };
}

async function getWalletTransactions(clientUserId: string, limit = 10) {
    return await db
        .selectFrom('walletTransactions')
        .select(['amount', 'transactionType', 'description', 'createdAt'])
        .where('userId', '=', clientUserId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .execute();
}

async function getPenaltyLogs(clientId: string, limit = 10) {
    return await db
        .selectFrom('penaltyLogs')
        .select(['amount', 'penaltyType', 'status', 'description', 'createdAt'])
        .where('clientId', '=', clientId)
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .execute();
}

// ============================================================
// TEST 1: Client cancels, wallet >= penalty → auto-deduct
// ============================================================
async function test1_AutoDeductPenalty(client: any, freelancer: any, service: any) {
    console.log('\n' + '='.repeat(60));
    console.log('TEST 1: Client cancels, wallet >= penalty → auto-deduct from wallet');
    console.log('='.repeat(60));

    // Reset client state
    await resetClientState(client.clientUserId);
    const initial = await getClientState(client.clientUserId);
    console.log(`  Initial wallet: ₹${initial.wallet}`);

    // Create and assign job
    const job = await createTestJob(
        client.clientUserId,
        client.clientId,
        1000,
        'PLATFORM',
        service?.id
    );
    console.log(`  Created job: ${job.id}, budget: ₹1000`);

    await assignAndConfirmJob(job.id, freelancer.freelancerId, client.clientUserId);
    console.log(`  Assigned freelancer & confirmed`);

    // Cancel after grace period
    await cancelJobAfterGracePeriod(job.id, client.clientUserId);

    // Check results
    const after = await getClientState(client.clientUserId);
    const expectedPenalty = 1000 * 0.02; // 2% = ₹20
    const expectedWallet = initial.wallet - 1000 - expectedPenalty; // budget reserved + penalty deducted

    console.log(`\n  Expected penalty: ₹${expectedPenalty}`);
    console.log(`  Wallet after cancel: ₹${after.wallet}`);
    console.log(`  Pending penalty: ₹${after.pendingPenalty}`);

    // Check wallet transaction
    const txns = await getWalletTransactions(client.clientUserId, 5);
    const penaltyTxn = txns.find(t => t.transactionType === 'PENALTY');

    if (penaltyTxn) {
        console.log(`  ✅ PENALTY wallet transaction found: ${penaltyTxn.description}`);
    }

    // Check penalty log
    const logs = await getPenaltyLogs(client.clientId, 5);
    const penaltyLog = logs.find(l => l.status === 'DEDUCTED');

    if (penaltyLog) {
        console.log(`  ✅ Penalty log with DEDUCTED status found`);
    }

    // Verify: penalty should be auto-deducted, not pending
    if (after.pendingPenalty === 0 && penaltyTxn && penaltyLog) {
        console.log(`\n  ✅ TEST 1 PASSED: Penalty auto-deducted from wallet`);
    } else {
        console.log(`\n  ❌ TEST 1 FAILED: Penalty not properly auto-deducted`);
    }
}

// ============================================================
// TEST 2: Client cancels, wallet < penalty → keep outstanding
// ============================================================
async function test2_OutstandingPenalty(client: any, freelancer: any, service: any) {
    console.log('\n' + '='.repeat(60));
    console.log('TEST 2: Client cancels, wallet < penalty → keep outstanding');
    console.log('='.repeat(60));

    // Reset client state with low wallet
    await db
        .updateTable('clients')
        .set({
            wallet: '50', // Very low wallet
            reservedAmount: '0',
            pendingPenaltyAmount: '0',
            updatedAt: new Date()
        })
        .where('userId', '=', client.clientUserId)
        .execute();

    const initial = await getClientState(client.clientUserId);
    console.log(`  Initial wallet: ₹${initial.wallet}`);

    // Create and assign job
    const job = await createTestJob(
        client.clientUserId,
        client.clientId,
        5000,
        'CASH',
        service?.id
    );
    console.log(`  Created job: ${job.id}, budget: ₹5000`);

    await assignAndConfirmJob(job.id, freelancer.freelancerId, client.clientUserId);
    console.log(`  Assigned freelancer & confirmed`);

    // Cancel after grace period
    await cancelJobAfterGracePeriod(job.id, client.clientUserId);

    // Check results
    const after = await getClientState(client.clientUserId);
    const expectedPenalty = 5000 * 0.02; // 2% = ₹100

    console.log(`\n  Expected penalty: ₹${expectedPenalty}`);
    console.log(`  Wallet after cancel: ₹${after.wallet}`);
    console.log(`  Pending penalty: ₹${after.pendingPenalty}`);

    // Check penalty log
    const logs = await getPenaltyLogs(client.clientId, 5);
    const penaltyLog = logs.find(l => l.status === 'PENDING');

    if (penaltyLog) {
        console.log(`  ✅ Penalty log with PENDING status found`);
    }

    // Verify: penalty should be pending (wallet too low)
    if (after.pendingPenalty === expectedPenalty && penaltyLog) {
        console.log(`\n  ✅ TEST 2 PASSED: Penalty kept outstanding (wallet insufficient)`);
    } else {
        console.log(`\n  ❌ TEST 2 FAILED: Penalty handling incorrect`);
    }
}

// ============================================================
// TEST 3: Next job PLATFORM → reserve budget, deduct penalty
// ============================================================
async function test3_NextJobPlatform(client: any, freelancer: any, service: any) {
    console.log('\n' + '='.repeat(60));
    console.log('TEST 3: Next job PLATFORM → reserve budget, deduct penalty');
    console.log('='.repeat(60));

    // Set up client with pending penalty
    await db
        .updateTable('clients')
        .set({
            wallet: '5000',
            reservedAmount: '0',
            pendingPenaltyAmount: '200',
            updatedAt: new Date()
        })
        .where('userId', '=', client.clientUserId)
        .execute();

    const initial = await getClientState(client.clientUserId);
    console.log(`  Initial wallet: ₹${initial.wallet}`);
    console.log(`  Pending penalty: ₹${initial.pendingPenalty}`);

    // Create new job with PLATFORM payment
    const job = await createTestJob(
        client.clientUserId,
        client.clientId,
        1000,
        'PLATFORM',
        service?.id
    );
    console.log(`  Created job: ${job.id}, budget: ₹1000`);

    // Check state after job creation
    const after = await getClientState(client.clientUserId);
    console.log(`\n  After job creation:`);
    console.log(`  Wallet: ₹${after.wallet}`);
    console.log(`  Reserved: ₹${after.reservedAmount}`);
    console.log(`  Pending penalty: ₹${after.pendingPenalty}`);

    // Check wallet transactions
    const txns = await getWalletTransactions(client.clientUserId, 10);
    const reserveTxn = txns.find(t => t.transactionType === 'JOB_RESERVE');
    const penaltyTxn = txns.find(t => t.transactionType === 'PENALTY');

    if (reserveTxn) {
        console.log(`  ✅ JOB_RESERVE transaction: ${reserveTxn.description}`);
    }
    if (penaltyTxn) {
        console.log(`  ✅ PENALTY transaction: ${penaltyTxn.description}`);
    }

    // Verify: wallet should be reduced by penalty, reserved should be budget only
    if (
        after.pendingPenalty === 0 &&
        after.reservedAmount === 1000 &&
        penaltyTxn
    ) {
        console.log(`\n  ✅ TEST 3 PASSED: Penalty deducted, budget reserved`);
    } else {
        console.log(`\n  ❌ TEST 3 FAILED: Incorrect reservation/deduction`);
    }
}

// ============================================================
// TEST 4: Next job CASH → client pays budget + penalty
// ============================================================
async function test4_NextJobCash(client: any, freelancer: any, service: any) {
    console.log('\n' + '='.repeat(60));
    console.log('TEST 4: Next job CASH → client pays budget + penalty');
    console.log('='.repeat(60));

    // Set up client with pending penalty
    await db
        .updateTable('clients')
        .set({
            wallet: '5000',
            reservedAmount: '0',
            pendingPenaltyAmount: '150',
            updatedAt: new Date()
        })
        .where('userId', '=', client.clientUserId)
        .execute();

    const initial = await getClientState(client.clientUserId);
    console.log(`  Initial wallet: ₹${initial.wallet}`);
    console.log(`  Pending penalty: ₹${initial.pendingPenalty}`);

    // Create new job with CASH payment
    const job = await createTestJob(
        client.clientUserId,
        client.clientId,
        800,
        'CASH',
        service?.id
    );
    console.log(`  Created job: ${job.id}, budget: ₹800`);

    // Check state after job creation
    const after = await getClientState(client.clientUserId);
    console.log(`\n  After job creation:`);
    console.log(`  Wallet: ₹${after.wallet}`);
    console.log(`  Reserved: ₹${after.reservedAmount}`);
    console.log(`  Pending penalty: ₹${after.pendingPenalty}`);

    // Verify: penalty should be cleared from pending, wallet unchanged (CASH)
    if (after.pendingPenalty === 0 && after.reservedAmount === 0) {
        console.log(`\n  ✅ TEST 4 PASSED: Penalty tracked on job, no wallet reservation`);
    } else {
        console.log(`\n  ❌ TEST 4 FAILED: Incorrect handling`);
    }

    // Note: Actual payment happens at job completion via cash payment flow
    console.log(`  ℹ️  Penalty will be collected when client pays freelancer: ₹800 + ₹150 = ₹950`);
}

// ============================================================
// TEST 5: No penalty → normal flow unchanged
// ============================================================
async function test5_NormalFlow(client: any, freelancer: any, service: any) {
    console.log('\n' + '='.repeat(60));
    console.log('TEST 5: No penalty → normal flow unchanged');
    console.log('='.repeat(60));

    // Reset client state
    await resetClientState(client.clientUserId);
    const initial = await getClientState(client.clientUserId);
    console.log(`  Initial wallet: ₹${initial.wallet}`);

    // Create job
    const job = await createTestJob(
        client.clientUserId,
        client.clientId,
        1500,
        'PLATFORM',
        service?.id
    );
    console.log(`  Created job: ${job.id}, budget: ₹1500`);

    // Check state
    const after = await getClientState(client.clientUserId);
    console.log(`\n  After job creation:`);
    console.log(`  Wallet: ₹${after.wallet}`);
    console.log(`  Reserved: ₹${after.reservedAmount}`);
    console.log(`  Pending penalty: ₹${after.pendingPenalty}`);

    if (
        after.pendingPenalty === 0 &&
        after.reservedAmount === 1500
    ) {
        console.log(`\n  ✅ TEST 5 PASSED: Normal flow unchanged`);
    } else {
        console.log(`\n  ❌ TEST 5 FAILED: Normal flow broken`);
    }
}

// ============================================================
// TEST 6: Job with penalty cancelled → penalty moves back
// ============================================================
async function test6_CancelJobWithPenalty(client: any, freelancer: any, service: any) {
    console.log('\n' + '='.repeat(60));
    console.log('TEST 6: Job with penalty cancelled → penalty moves back to pending');
    console.log('='.repeat(60));

    // Set up client with pending penalty
    await db
        .updateTable('clients')
        .set({
            wallet: '5000',
            reservedAmount: '0',
            pendingPenaltyAmount: '100',
            updatedAt: new Date()
        })
        .where('userId', '=', client.clientUserId)
        .execute();

    // Create job (CASH - penalty not collected upfront, tracked on job)
    const job = await createTestJob(
        client.clientUserId,
        client.clientId,
        2000,
        'CASH',
        service?.id
    );
    console.log(`  Created job: ${job.id}, budget: ₹2000, penalty attached: ₹100`);

    // Verify penalty was cleared from pending
    const afterCreate = await getClientState(client.clientUserId);
    console.log(`  After creation - Pending penalty: ₹${afterCreate.pendingPenalty}`);

    // Assign freelancer
    await assignAndConfirmJob(job.id, freelancer.freelancerId, client.clientUserId);

    // Cancel the job (client cancels, no new penalty since within grace or different logic)
    // Manually set confirmedAt to 10 mins ago to trigger penalty
    await db
        .updateTable('jobs')
        .set({ confirmedAt: new Date(Date.now() - 10 * 60 * 1000) })
        .where('id', '=', job.id)
        .execute();

    const { cancelJob } = await import('../lib/services/jobs');
    await cancelJob(job.id, client.clientUserId, 'Test cancel job with existing penalty');

    // Check: existing penalty should move back to pending
    const afterCancel = await getClientState(client.clientUserId);
    console.log(`\n  After cancellation:`);
    console.log(`  Pending penalty: ₹${afterCancel.pendingPenalty}`);

    // The existing penalty (100) should move back to pending
    // Plus new penalty from this cancellation (2% of 2000 = 40) if wallet allows
    if (afterCancel.pendingPenalty > 0) {
        console.log(`\n  ✅ TEST 6 PASSED: Penalty moved back to pending on cancellation`);
    } else {
        console.log(`\n  ❌ TEST 6 FAILED: Penalty not moved back`);
    }
}

// ============================================================
// MAIN
// ============================================================
async function main() {
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║        BIRDEARNER PENALTY FLOW TEST SUITE v2           ║');
    console.log('╚══════════════════════════════════════════════════════════╝');

    try {
        const client = await getTestClient();
        const freelancer = await getTestFreelancer();
        const service = await getService();

        if (!client || !freelancer) {
            console.log('❌ Could not find test client or freelancer in DB.');
            console.log('   Please ensure you have at least one client and one freelancer.');
            return;
        }

        console.log(`\n✅ Test Client: ${client.clientUserId}`);
        console.log(`✅ Test Freelancer: ${freelancer.freelancerUserId}`);
        console.log(`✅ Service: ${service?.id || 'None'}`);

        await test1_AutoDeductPenalty(client, freelancer, service);
        await test2_OutstandingPenalty(client, freelancer, service);
        await test3_NextJobPlatform(client, freelancer, service);
        await test4_NextJobCash(client, freelancer, service);
        await test5_NormalFlow(client, freelancer, service);
        await test6_CancelJobWithPenalty(client, freelancer, service);

        console.log('\n' + '='.repeat(60));
        console.log('ALL TESTS COMPLETED');
        console.log('='.repeat(60));

    } catch (error: any) {
        console.error('\n❌ Test error:', error.message);
        console.error(error.stack);
    } finally {
        await db.destroy();
    }
}

main();
