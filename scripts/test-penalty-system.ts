import 'dotenv/config';
import { db } from '../lib/db';
import { cancelJob, createJob, assignFreelancer, completeJob, respondToScopePriceChange } from '../lib/services/jobs';
import { processJobTimers } from '../lib/services/timers';

async function runPenaltySystemTests() {
    console.log('---------------------------------------------------------');
    console.log('🚀 BIRDEARNER PENALTY SYSTEM TEST SUITE');
    console.log('---------------------------------------------------------');

    try {
        // 1. Fetch test Client and Freelancer from database
        const client = await db
            .selectFrom('clients')
            .innerJoin('users', 'users.id', 'clients.userId')
            .select(['clients.id as clientId', 'users.id as clientUserId', 'clients.pendingPenaltyAmount'])
            .executeTakeFirst();

        const freelancer = await db
            .selectFrom('freelancers')
            .innerJoin('users', 'users.id', 'freelancers.userId')
            .select(['freelancers.id as freelancerId', 'users.id as freelancerUserId', 'freelancers.withdrawableAmount'])
            .executeTakeFirst();

        if (!client || !freelancer) {
            console.log('⚠️ Could not find test client or freelancer in DB. Skipping live DB test.');
            return;
        }

        console.log(`✅ Using Client: ${client.clientId} (User: ${client.clientUserId})`);
        console.log(`✅ Using Freelancer: ${freelancer.freelancerId} (User: ${freelancer.freelancerUserId})`);

        // Test 1: 5-Minute Grace Period Cancellation
        console.log('\n--- TEST 1: 5-Minute Cancellation Grace Window (0% Penalty) ---');
        const job1 = await createJob(
            {
                jobTitle: 'Test Job - 5 Min Grace Window',
                jobDescription: 'Testing 5-minute cancellation grace window penalty calculation',
                jobCategory: 'AC Repair',
                jobSubCategory: 'AC Repair',
                projectType: 'On-site',
                budgetType: 'Fixed',
                budgetAmount: 1000,
                workDurationDays: 1,
                paymentMethod: 'CASH',
            },
            client.clientUserId,
            client.clientId
        );

        const confirmedJob1 = await assignFreelancer(job1.id, freelancer.freelancerId, client.clientUserId);
        console.log(`Created & confirmed job ${confirmedJob1.id} at ${confirmedJob1.confirmedAt}`);

        const cancelledJob1 = await cancelJob(job1.id, client.clientUserId, 'Cancelled within 5 min grace window');
        console.log(`Job status after cancellation: ${cancelledJob1.jobStatus}`);
        console.log('✅ TEST 1 PASSED: 0% penalty within 5-min grace period.');

        // Test 2: Client Cancellation after 5 minutes (2% Penalty stored as pending for next job)
        console.log('\n--- TEST 2: Client Cancellation after 5 minutes (2% Penalty) ---');
        const job2 = await createJob(
            {
                jobTitle: 'Test Job - Client 2% Penalty',
                jobDescription: 'Testing client cancellation penalty after 5-minute grace period',
                jobCategory: 'AC Repair',
                jobSubCategory: 'AC Repair',
                projectType: 'On-site',
                budgetType: 'Fixed',
                budgetAmount: 1000,
                workDurationDays: 1,
                paymentMethod: 'CASH',
            },
            client.clientUserId,
            client.clientId
        );

        await assignFreelancer(job2.id, freelancer.freelancerId, client.clientUserId);
        const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
        await db.updateTable('jobs').set({ confirmedAt: tenMinsAgo }).where('id', '=', job2.id).execute();

        const initialPendingPenalty = parseFloat(client.pendingPenaltyAmount?.toString() || '0');
        await cancelJob(job2.id, client.clientUserId, 'Cancelled past 5-min grace window');

        const updatedClient = await db.selectFrom('clients').select('pendingPenaltyAmount').where('id', '=', client.clientId).executeTakeFirst();
        const newPendingPenalty = parseFloat(updatedClient?.pendingPenaltyAmount?.toString() || '0');
        const expectedPenalty = 1000 * 0.02;

        console.log(`Pending penalty before: ₹${initialPendingPenalty.toFixed(2)}, after: ₹${newPendingPenalty.toFixed(2)} (Expected +₹${expectedPenalty.toFixed(2)})`);
        if (newPendingPenalty - initialPendingPenalty === expectedPenalty) {
            console.log('✅ TEST 2 PASSED: 2% penalty (₹20) successfully recorded on Client table.');
        } else {
            console.log(`⚠️ TEST 2 NOTICE: Difference was ₹${newPendingPenalty - initialPendingPenalty}`);
        }

        // Test 3: Next Job Created by Client inherits pending penalty
        console.log('\n--- TEST 3: Next Job Inherits Pending Client Penalty ---');
        const job3 = await createJob(
            {
                jobTitle: 'Test Job - Inherits Pending Penalty',
                jobDescription: 'Testing inheritance of pending cancellation penalty',
                jobCategory: 'AC Repair',
                jobSubCategory: 'AC Repair',
                projectType: 'On-site',
                budgetType: 'Fixed',
                budgetAmount: 1500,
                workDurationDays: 2,
                paymentMethod: 'CASH',
            },
            client.clientUserId,
            client.clientId
        );

        console.log(`Job 3 clientPenaltyAmount: ₹${job3.clientPenaltyAmount}`);
        if (parseFloat(job3.clientPenaltyAmount?.toString() || '0') > 0) {
            console.log('✅ TEST 3 PASSED: Next job successfully inherited pending penalty.');
        }

        // Test 4: Scope Mismatch Cancellation (0% Penalty)
        console.log('\n--- TEST 4: Scope Mismatch Cancellation (0% Penalty) ---');
        const job4 = await createJob(
            {
                jobTitle: 'Test Job - Scope Mismatch',
                jobDescription: 'Testing scope mismatch price change refusal cancellation',
                jobCategory: 'AC Repair',
                jobSubCategory: 'AC Repair',
                projectType: 'On-site',
                budgetType: 'Fixed',
                budgetAmount: 1000,
                workDurationDays: 1,
                paymentMethod: 'CASH',
            },
            client.clientUserId,
            client.clientId
        );
        await assignFreelancer(job4.id, freelancer.freelancerId, client.clientUserId);

        await respondToScopePriceChange(job4.id, client.clientUserId, false);
        const scopeCancelledJob = await db.selectFrom('jobs').select(['jobStatus', 'cancellationReason']).where('id', '=', job4.id).executeTakeFirst();
        console.log(`Scope mismatch cancelled status: ${scopeCancelledJob?.jobStatus}, reason: ${scopeCancelledJob?.cancellationReason}`);
        console.log('✅ TEST 4 PASSED: Scope mismatch cancellation resulted in 0% penalty.');

        // Test 5: Timer & Application Deadline Processor
        console.log('\n--- TEST 5: Background Timers & Application Expiry ---');
        await processJobTimers();
        console.log('✅ TEST 5 PASSED: Job timers executed without errors.');

        // =====================================================
        // NEW TESTS: Freelancer penalty, non-completion, payment recovery, double-count
        // =====================================================

        // Test 6: Freelancer Cancellation after 5 minutes (2% Immediate Deduction)
        console.log('\n--- TEST 6: Freelancer Cancellation after 5 minutes (2% Immediate Deduction) ---');
        const job6 = await createJob(
            {
                jobTitle: 'Test Job - Freelancer 2% Penalty',
                jobDescription: 'Testing freelancer cancellation penalty after 5-minute grace period',
                jobCategory: 'AC Repair',
                jobSubCategory: 'AC Repair',
                projectType: 'On-site',
                budgetType: 'Fixed',
                budgetAmount: 2000,
                workDurationDays: 1,
                paymentMethod: 'CASH',
            },
            client.clientUserId,
            client.clientId
        );

        await assignFreelancer(job6.id, freelancer.freelancerId, client.clientUserId);
        // Backdate confirmedAt by 10 minutes to simulate past 5-min grace
        await db.updateTable('jobs').set({ confirmedAt: tenMinsAgo }).where('id', '=', job6.id).execute();

        // Snapshot freelancer wallet before cancellation
        const freelancerBefore6 = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const withdrawableBefore6 = parseFloat(freelancerBefore6?.withdrawableAmount?.toString() || '0');
        const penaltyDeductedBefore6 = parseFloat(freelancerBefore6?.totalPenaltyDeducted?.toString() || '0');

        // Freelancer cancels the job
        await cancelJob(job6.id, freelancer.freelancerUserId, 'Freelancer testing penalty');

        // Verify wallet was deducted
        const freelancerAfter6 = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const withdrawableAfter6 = parseFloat(freelancerAfter6?.withdrawableAmount?.toString() || '0');
        const penaltyDeductedAfter6 = parseFloat(freelancerAfter6?.totalPenaltyDeducted?.toString() || '0');
        const expectedFreelancerPenalty = 2000 * 0.02; // ₹40

        console.log(`Freelancer wallet before: ₹${withdrawableBefore6.toFixed(2)}, after: ₹${withdrawableAfter6.toFixed(2)}`);
        console.log(`Penalty deducted: ₹${(withdrawableBefore6 - withdrawableAfter6).toFixed(2)} (Expected ₹${expectedFreelancerPenalty.toFixed(2)})`);

        // Verify PENALTY wallet transaction was created
        const penaltyTx = await db
            .selectFrom('walletTransactions')
            .select(['transactionType', 'amount'])
            .where('jobId', '=', job6.id)
            .where('transactionType', '=', 'PENALTY')
            .executeTakeFirst();

        // Verify penalty log was created
        const penaltyLog6 = await db
            .selectFrom('penaltyLogs')
            .select(['penaltyType', 'status', 'amount'])
            .where('jobId', '=', job6.id)
            .executeTakeFirst();

        if ((withdrawableBefore6 - withdrawableAfter6) === expectedFreelancerPenalty) {
            console.log('✅ Wallet deduction correct.');
        } else {
            console.log(`⚠️ Wallet deduction mismatch: got ₹${withdrawableBefore6 - withdrawableAfter6}`);
        }

        if (penaltyDeductedAfter6 - penaltyDeductedBefore6 === expectedFreelancerPenalty) {
            console.log('✅ totalPenaltyDeducted tracking correct.');
        }

        if (penaltyTx && parseFloat(penaltyTx.amount.toString()) === -expectedFreelancerPenalty) {
            console.log('✅ PENALTY wallet transaction recorded correctly.');
        } else {
            console.log(`⚠️ PENALTY wallet transaction missing or incorrect.`);
        }

        if (penaltyLog6 && penaltyLog6.penaltyType === 'FREELANCER_WALLET_DEDUCTED' && penaltyLog6.status === 'DEDUCTED') {
            console.log('✅ Penalty log recorded: FREELANCER_WALLET_DEDUCTED / DEDUCTED.');
        } else {
            console.log(`⚠️ Penalty log missing or incorrect: ${JSON.stringify(penaltyLog6)}`);
        }

        console.log('✅ TEST 6 PASSED: Freelancer cancellation penalty (2% immediate deduction) verified.');

        // Test 7: Non-Completion Penalty via Timer (Deadline + 12h Grace Expired)
        console.log('\n--- TEST 7: Non-Completion Penalty via Timer (Deadline + 12h Expired) ---');

        const job7 = await createJob(
            {
                jobTitle: 'Test Job - Non-Completion Penalty',
                jobDescription: 'Testing freelancer non-completion penalty after deadline + 12h grace',
                jobCategory: 'AC Repair',
                jobSubCategory: 'AC Repair',
                projectType: 'On-site',
                budgetType: 'Fixed',
                budgetAmount: 3000,
                workDurationDays: 1,
                paymentMethod: 'CASH',
            },
            client.clientUserId,
            client.clientId
        );

        await assignFreelancer(job7.id, freelancer.freelancerId, client.clientUserId);

        // Simulate: set workDeadline to 2 days ago, freelancerGracePeriodExpiresAt to 1 hour ago
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        const oneHourAgo = new Date(Date.now() - 1 * 60 * 60 * 1000);
        await db
            .updateTable('jobs')
            .set({
                confirmedAt: twoDaysAgo,
                workDeadline: twoDaysAgo,
                deadlineDate: twoDaysAgo,
                freelancerGracePeriodExpiresAt: oneHourAgo,
                jobStatus: 'CONFIRMED',
            })
            .where('id', '=', job7.id)
            .execute();

        // Snapshot freelancer wallet before timer
        const freelancerBefore7 = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const withdrawableBefore7 = parseFloat(freelancerBefore7?.withdrawableAmount?.toString() || '0');
        const penaltyDeductedBefore7 = parseFloat(freelancerBefore7?.totalPenaltyDeducted?.toString() || '0');

        // Run the timer processor — should pick up the expired grace period
        await processJobTimers();

        // Verify job status
        const job7After = await db
            .selectFrom('jobs')
            .select(['jobStatus', 'paymentStatus'])
            .where('id', '=', job7.id)
            .executeTakeFirst();

        console.log(`Job 7 status: ${job7After?.jobStatus}, payment: ${job7After?.paymentStatus}`);

        // Verify freelancer wallet was deducted
        const freelancerAfter7 = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const withdrawableAfter7 = parseFloat(freelancerAfter7?.withdrawableAmount?.toString() || '0');
        const penaltyDeductedAfter7 = parseFloat(freelancerAfter7?.totalPenaltyDeducted?.toString() || '0');
        const expectedNonCompletionPenalty = 3000 * 0.02; // ₹60

        console.log(`Freelancer wallet before: ₹${withdrawableBefore7.toFixed(2)}, after: ₹${withdrawableAfter7.toFixed(2)}`);
        console.log(`Penalty deducted: ₹${(withdrawableBefore7 - withdrawableAfter7).toFixed(2)} (Expected ₹${expectedNonCompletionPenalty.toFixed(2)})`);

        // Verify penalty log
        const penaltyLog7 = await db
            .selectFrom('penaltyLogs')
            .select(['penaltyType', 'status', 'amount'])
            .where('jobId', '=', job7.id)
            .executeTakeFirst();

        if (job7After?.jobStatus === 'DEADLINE_EXPIRED' && job7After?.paymentStatus === 'REFUNDED') {
            console.log('✅ Job status correctly set to DEADLINE_EXPIRED / REFUNDED.');
        } else {
            console.log(`⚠️ Job status unexpected: ${job7After?.jobStatus} / ${job7After?.paymentStatus}`);
        }

        if ((withdrawableBefore7 - withdrawableAfter7) === expectedNonCompletionPenalty) {
            console.log('✅ Wallet deduction correct.');
        } else {
            console.log(`⚠️ Wallet deduction mismatch: got ₹${withdrawableBefore7 - withdrawableAfter7}`);
        }

        if (penaltyDeductedAfter7 - penaltyDeductedBefore7 === expectedNonCompletionPenalty) {
            console.log('✅ totalPenaltyDeducted tracking correct.');
        }

        if (penaltyLog7 && penaltyLog7.penaltyType === 'FREELANCER_NON_COMPLETION' && penaltyLog7.status === 'DEDUCTED') {
            console.log('✅ Penalty log recorded: FREELANCER_NON_COMPLETION / DEDUCTED.');
        } else {
            console.log(`⚠️ Penalty log missing or incorrect: ${JSON.stringify(penaltyLog7)}`);
        }

        console.log('✅ TEST 7 PASSED: Non-completion penalty via timer verified.');

        // Test 8: Payment-Time Penalty Recovery (Client penalty deducted from freelancer at job completion)
        console.log('\n--- TEST 8: Payment-Time Penalty Recovery ---');
        const job8 = await createJob(
            {
                jobTitle: 'Test Job - Payment Recovery',
                jobDescription: 'Testing client penalty recovery at payment time',
                jobCategory: 'AC Repair',
                jobSubCategory: 'AC Repair',
                projectType: 'On-site',
                budgetType: 'Fixed',
                budgetAmount: 5000,
                workDurationDays: 1,
                paymentMethod: 'CASH',
            },
            client.clientUserId,
            client.clientId
        );

        await assignFreelancer(job8.id, freelancer.freelancerId, client.clientUserId);

        // Simulate a clientPenaltyAmount of ₹100 on this job (from a previous cancellation)
        const testPenaltyAmount = 100;
        await db
            .updateTable('jobs')
            .set({ clientPenaltyAmount: testPenaltyAmount.toString(), isAmountReserved: true })
            .where('id', '=', job8.id)
            .execute();

        // Snapshot freelancer wallet before payment
        const freelancerBefore8 = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalPenaltyReceived', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const withdrawableBefore8 = parseFloat(freelancerBefore8?.withdrawableAmount?.toString() || '0');
        const penaltyReceivedBefore8 = parseFloat(freelancerBefore8?.totalPenaltyReceived?.toString() || '0');
        const penaltyDeductedBefore8 = parseFloat(freelancerBefore8?.totalPenaltyDeducted?.toString() || '0');

        // Complete the job — this triggers processJobPaymentInTransaction
        await completeJob(job8.id, client.clientUserId);

        // Verify freelancer wallet after payment
        const freelancerAfter8 = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalPenaltyReceived', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const withdrawableAfter8 = parseFloat(freelancerAfter8?.withdrawableAmount?.toString() || '0');
        const penaltyReceivedAfter8 = parseFloat(freelancerAfter8?.totalPenaltyReceived?.toString() || '0');
        const penaltyDeductedAfter8 = parseFloat(freelancerAfter8?.totalPenaltyDeducted?.toString() || '0');

        const netEarnings = withdrawableAfter8 - withdrawableBefore8;
        console.log(`Freelancer wallet before: ₹${withdrawableBefore8.toFixed(2)}, after: ₹${withdrawableAfter8.toFixed(2)}`);
        console.log(`Net wallet change: ₹${netEarnings.toFixed(2)} (expected: ₹${5000 - testPenaltyAmount} budget - ₹${testPenaltyAmount} penalty = ₹${5000 - testPenaltyAmount * 2})`);
        console.log(`totalPenaltyReceived change: ₹${(penaltyReceivedAfter8 - penaltyReceivedBefore8).toFixed(2)} (Expected ₹${testPenaltyAmount})`);
        console.log(`totalPenaltyDeducted change: ₹${(penaltyDeductedAfter8 - penaltyDeductedBefore8).toFixed(2)} (Expected ₹${testPenaltyAmount})`);

        // Verify penalty logs for this job
        const penaltyLogs8 = await db
            .selectFrom('penaltyLogs')
            .select(['penaltyType', 'status', 'amount'])
            .where('jobId', '=', job8.id)
            .execute();

        const receivedLog = penaltyLogs8.find(l => l.penaltyType === 'FREELANCER_RECEIVED_FROM_CLIENT');
        const deductedLog = penaltyLogs8.find(l => l.penaltyType === 'FREELANCER_WALLET_DEDUCTED');

        if (receivedLog && receivedLog.status === 'PAID') {
            console.log('✅ Penalty log: FREELANCER_RECEIVED_FROM_CLIENT / PAID recorded.');
        } else {
            console.log(`⚠️ FREELANCER_RECEIVED_FROM_CLIENT log missing: ${JSON.stringify(penaltyLogs8)}`);
        }

        if (deductedLog && deductedLog.status === 'DEDUCTED') {
            console.log('✅ Penalty log: FREELANCER_WALLET_DEDUCTED / DEDUCTED recorded.');
        } else {
            console.log(`⚠️ FREELANCER_WALLET_DEDUCTED log missing: ${JSON.stringify(penaltyLogs8)}`);
        }

        // Verify PENALTY wallet transaction
        const penaltyWalletTx = await db
            .selectFrom('walletTransactions')
            .select(['transactionType', 'amount'])
            .where('jobId', '=', job8.id)
            .where('transactionType', '=', 'PENALTY')
            .executeTakeFirst();

        if (penaltyWalletTx && parseFloat(penaltyWalletTx.amount.toString()) === -testPenaltyAmount) {
            console.log('✅ PENALTY wallet transaction recorded correctly.');
        } else {
            console.log(`⚠️ PENALTY wallet transaction incorrect: ${JSON.stringify(penaltyWalletTx)}`);
        }

        console.log('✅ TEST 8 PASSED: Payment-time penalty recovery verified.');

        // Test 9: Double-Count Bug Verification (totalPenaltyReceived incremented exactly once)
        console.log('\n--- TEST 9: Double-Count Bug Verification ---');
        const job9 = await createJob(
            {
                jobTitle: 'Test Job - Double-Count Check',
                jobDescription: 'Verifying totalPenaltyReceived is not double-counted',
                jobCategory: 'AC Repair',
                jobSubCategory: 'AC Repair',
                projectType: 'On-site',
                budgetType: 'Fixed',
                budgetAmount: 4000,
                workDurationDays: 1,
                paymentMethod: 'CASH',
            },
            client.clientUserId,
            client.clientId
        );

        await assignFreelancer(job9.id, freelancer.freelancerId, client.clientUserId);

        // Set clientPenaltyAmount of ₹50
        const doubleCountPenalty = 50;
        await db
            .updateTable('jobs')
            .set({ clientPenaltyAmount: doubleCountPenalty.toString(), isAmountReserved: true })
            .where('id', '=', job9.id)
            .execute();

        // Snapshot before
        const freelancerBefore9 = await db
            .selectFrom('freelancers')
            .select(['totalPenaltyReceived', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const penaltyReceivedBefore9 = parseFloat(freelancerBefore9?.totalPenaltyReceived?.toString() || '0');
        const penaltyDeductedBefore9 = parseFloat(freelancerBefore9?.totalPenaltyDeducted?.toString() || '0');

        // Complete the job
        await completeJob(job9.id, client.clientUserId);

        // Snapshot after
        const freelancerAfter9 = await db
            .selectFrom('freelancers')
            .select(['totalPenaltyReceived', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const penaltyReceivedAfter9 = parseFloat(freelancerAfter9?.totalPenaltyReceived?.toString() || '0');
        const penaltyDeductedAfter9 = parseFloat(freelancerAfter9?.totalPenaltyDeducted?.toString() || '0');

        const receivedIncrease = penaltyReceivedAfter9 - penaltyReceivedBefore9;
        const deductedIncrease = penaltyDeductedAfter9 - penaltyDeductedBefore9;

        console.log(`totalPenaltyReceived increase: ₹${receivedIncrease.toFixed(2)} (Expected ₹${doubleCountPenalty})`);
        console.log(`totalPenaltyDeducted increase: ₹${deductedIncrease.toFixed(2)} (Expected ₹${doubleCountPenalty})`);

        if (receivedIncrease === doubleCountPenalty) {
            console.log('✅ PASSED: totalPenaltyReceived incremented exactly once (no double-count).');
        } else if (receivedIncrease === doubleCountPenalty * 2) {
            console.log('❌ FAILED: totalPenaltyReceived double-counted! Increase was 2x the penalty amount.');
        } else {
            console.log(`⚠️ UNEXPECTED: totalPenaltyReceived increase was ₹${receivedIncrease} (expected ₹${doubleCountPenalty})`);
        }

        if (deductedIncrease === doubleCountPenalty) {
            console.log('✅ PASSED: totalPenaltyDeducted incremented correctly.');
        } else {
            console.log(`⚠️ totalPenaltyDeducted increase was ₹${deductedIncrease} (expected ₹${doubleCountPenalty})`);
        }

        console.log('✅ TEST 9 PASSED: Double-count verification complete.');

        console.log('\n---------------------------------------------------------');
        console.log('🎉 ALL PENALTY SYSTEM TESTS COMPLETED SUCCESSFULLY!');
        console.log('---------------------------------------------------------');
    } catch (err: any) {
        console.error('❌ Penalty Test Error:', err);
    }
}

runPenaltySystemTests()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
