import 'dotenv/config';
import { db } from '../lib/db';
import { createJob, assignFreelancer, cancelJob } from '../lib/services/jobs';

async function main() {
    console.log('--- REMOTE JOB CANCELLATION SPEC TEST (>5 MINS POST-ASSIGNMENT) ---');

    const client = await db
        .selectFrom('clients')
        .innerJoin('users', 'users.id', 'clients.userId')
        .select(['clients.id as clientId', 'users.id as clientUserId'])
        .executeTakeFirst();

    const freelancer = await db
        .selectFrom('freelancers')
        .innerJoin('users', 'users.id', 'freelancers.userId')
        .select(['freelancers.id as freelancerId', 'users.id as freelancerUserId'])
        .executeTakeFirst();

    if (!client || !freelancer) {
        console.error('Test client or freelancer not found');
        process.exit(1);
    }

    // Ensure client has enough wallet balance for test
    await db.updateTable('clients').set({ wallet: '10000.00', availableBalance: '10000.00', reservedAmount: '0.00' }).where('id', '=', client.clientId).execute();

    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);

    // ==========================================
    // SPEC TEST 1: CLIENT CANCELS REMOTE JOB AFTER 5 MINS
    // ==========================================
    console.log('\n--- SPEC TEST 1: CLIENT CANCELS REMOTE JOB AFTER 5 MINS ---');
    const job1 = await createJob(
        {
            jobTitle: 'Remote Spec Test 1 - Client Cancel',
            jobDescription: 'Remote cancellation test',
            jobCategory: 'DESIGN',
            jobSubCategory: 'GRAPHIC DESIGN',
            projectType: 'Remote',
            budgetType: 'Fixed',
            budgetAmount: 1000,
            workDurationDays: 1,
            paymentMethod: 'PLATFORM',
            location: 'Remote Work',
            latitude: 0,
            longitude: 0,
        },
        client.clientUserId,
        client.clientId
    );

    await assignFreelancer(job1.id, freelancer.freelancerId, client.clientUserId);
    // Backdate confirmedAt past 5-min grace
    await db.updateTable('jobs').set({ confirmedAt: tenMinsAgo }).where('id', '=', job1.id).execute();

    const clientBefore1 = await db.selectFrom('clients').select(['wallet', 'reservedAmount', 'availableBalance']).where('id', '=', client.clientId).executeTakeFirstOrThrow();
    console.log(`Client BEFORE Cancel: Wallet = ₹${clientBefore1.wallet}, Reserved = ₹${clientBefore1.reservedAmount}, Available = ₹${clientBefore1.availableBalance}`);

    await cancelJob(job1.id, client.clientUserId, 'Client cancelled after 10 mins');

    const clientAfter1 = await db.selectFrom('clients').select(['wallet', 'reservedAmount', 'availableBalance']).where('id', '=', client.clientId).executeTakeFirstOrThrow();
    console.log(`Client AFTER Cancel:  Wallet = ₹${clientAfter1.wallet}, Reserved = ₹${clientAfter1.reservedAmount}, Available = ₹${clientAfter1.availableBalance}`);

    const job1Record = await db.selectFrom('jobs').select(['jobStatus', 'isAmountReserved']).where('id', '=', job1.id).executeTakeFirstOrThrow();
    console.log(`Job Status: ${job1Record.jobStatus}, Reserved: ${job1Record.isAmountReserved}`);

    const penaltyTx1 = await db.selectFrom('walletTransactions').select(['transactionType', 'amount']).where('jobId', '=', job1.id).where('transactionType', '=', 'PENALTY').executeTakeFirst();
    console.log(`Penalty Transaction:`, penaltyTx1);

    if (job1Record.jobStatus === 'CANCELLED_BY_CLIENT' && !job1Record.isAmountReserved && penaltyTx1 && parseFloat(penaltyTx1.amount) === -20) {
        console.log('✅ SPEC TEST 1 PASSED: Client cancelled remote job after 5 mins. 100% reserved funds released, 2% (₹20) penalty deducted.');
    } else {
        console.error('❌ SPEC TEST 1 FAILED');
        process.exit(1);
    }

    // ==========================================
    // SPEC TEST 2: FREELANCER CANCELS REMOTE JOB AFTER 5 MINS
    // ==========================================
    console.log('\n--- SPEC TEST 2: FREELANCER CANCELS REMOTE JOB AFTER 5 MINS ---');
    const job2 = await createJob(
        {
            jobTitle: 'Remote Spec Test 2 - Freelancer Cancel',
            jobDescription: 'Remote cancellation test',
            jobCategory: 'DESIGN',
            jobSubCategory: 'GRAPHIC DESIGN',
            projectType: 'Remote',
            budgetType: 'Fixed',
            budgetAmount: 2000,
            workDurationDays: 1,
            paymentMethod: 'PLATFORM',
            location: 'Remote Work',
            latitude: 0,
            longitude: 0,
        },
        client.clientUserId,
        client.clientId
    );

    await assignFreelancer(job2.id, freelancer.freelancerId, client.clientUserId);
    // Backdate confirmedAt past 5-min grace
    await db.updateTable('jobs').set({ confirmedAt: tenMinsAgo }).where('id', '=', job2.id).execute();

    const clientBefore2 = await db.selectFrom('clients').select(['wallet', 'reservedAmount', 'availableBalance']).where('id', '=', client.clientId).executeTakeFirstOrThrow();
    const freelancerBefore2 = await db.selectFrom('freelancers').select(['withdrawableAmount', 'cancellationStrikes']).where('id', '=', freelancer.freelancerId).executeTakeFirstOrThrow();

    await cancelJob(job2.id, freelancer.freelancerUserId, 'Freelancer cancelled after 10 mins');

    const clientAfter2 = await db.selectFrom('clients').select(['wallet', 'reservedAmount', 'availableBalance']).where('id', '=', client.clientId).executeTakeFirstOrThrow();
    const freelancerAfter2 = await db.selectFrom('freelancers').select(['withdrawableAmount', 'cancellationStrikes', 'cooldownExpiresAt']).where('id', '=', freelancer.freelancerId).executeTakeFirstOrThrow();

    console.log(`Client Available BEFORE = ₹${clientBefore2.availableBalance}, AFTER = ₹${clientAfter2.availableBalance}`);
    console.log(`Freelancer Wallet BEFORE = ₹${freelancerBefore2.withdrawableAmount}, AFTER = ₹${freelancerAfter2.withdrawableAmount}`);
    console.log(`Freelancer Strikes BEFORE = ${freelancerBefore2.cancellationStrikes}, AFTER = ${freelancerAfter2.cancellationStrikes}`);

    const job2Record = await db.selectFrom('jobs').select(['jobStatus', 'isAmountReserved']).where('id', '=', job2.id).executeTakeFirstOrThrow();
    const penaltyTx2 = await db.selectFrom('walletTransactions').select(['transactionType', 'amount']).where('jobId', '=', job2.id).where('transactionType', '=', 'PENALTY').executeTakeFirst();

    const freelancerDeduction = parseFloat(freelancerBefore2.withdrawableAmount) - parseFloat(freelancerAfter2.withdrawableAmount);

    if (job2Record.jobStatus === 'CANCELLED_BY_FREELANCER' && !job2Record.isAmountReserved && penaltyTx2 && freelancerDeduction === 40 && freelancerAfter2.cancellationStrikes === freelancerBefore2.cancellationStrikes + 1) {
        console.log('✅ SPEC TEST 2 PASSED: Freelancer cancelled remote job after 5 mins. Client received 100% refund, 2% (₹40) penalty deducted from freelancer, +1 strike and cooldown applied.');
    } else {
        console.error('❌ SPEC TEST 2 FAILED');
        process.exit(1);
    }

    console.log('\n--- REMOTE JOB CANCELLATION SPEC TEST COMPLETE ---');
    process.exit(0);
}

main().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
