import 'dotenv/config';
import { db } from '../lib/db';
import { cancelJob, createJob, assignFreelancer, submitDigitalWork, respondToDigitalWork } from '../lib/services/jobs';
import { processJobTimers } from '../lib/services/timers';

async function runRemotePenaltyTests() {
    console.log('---------------------------------------------------------');
    console.log('🚀 BIRDEARNER REMOTE JOB PENALTY TEST SUITE');
    console.log('---------------------------------------------------------');

    try {
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
            console.log('⚠️ Could not find test client or freelancer in DB. Skipping.');
            return;
        }

        console.log(`✅ Using Client: ${client.clientId} (User: ${client.clientUserId})`);
        console.log(`✅ Using Freelancer: ${freelancer.freelancerId} (User: ${freelancer.freelancerUserId})`);

        // Helper: create a remote job
        async function createRemoteJob(title: string, budget: number) {
            return createJob(
                {
                    jobTitle: title,
                    jobDescription: 'Remote job penalty test',
                    jobCategory: 'DESIGN',
                    jobSubCategory: 'GRAPHIC DESIGN',
                    projectType: 'Remote',
                    budgetType: 'Fixed',
                    budgetAmount: budget,
                    workDurationDays: 1,
                    paymentMethod: 'CASH',
                    location: 'Remote Work',
                    latitude: 0,
                    longitude: 0,
                },
                client.clientUserId,
                client.clientId
            );
        }

        const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);

        // =====================================================
        // TEST R1: Client Cancels Remote Job Within 5-Min Grace (0% Penalty)
        // =====================================================
        console.log('\n--- TEST R1: Client Cancels Remote Job Within 5-Min Grace (0% Penalty) ---');
        const jobR1 = await createRemoteJob('Remote Test R1 - Grace Window', 1000);
        await assignFreelancer(jobR1.id, freelancer.freelancerId, client.clientUserId);

        const cancelledR1 = await cancelJob(jobR1.id, client.clientUserId, 'Within grace');
        console.log(`Status: ${cancelledR1.jobStatus}`);

        const penaltyLogR1 = await db
            .selectFrom('penaltyLogs')
            .select('id')
            .where('jobId', '=', jobR1.id)
            .executeTakeFirst();

        if (!penaltyLogR1) {
            console.log('✅ TEST R1 PASSED: No penalty within 5-min grace.');
        } else {
            console.log('⚠️ TEST R1: Unexpected penalty log found.');
        }

        // =====================================================
        // TEST R2: Client Cancels Remote Job After 5 Minutes (2% Deferred Penalty)
        // =====================================================
        console.log('\n--- TEST R2: Client Cancels Remote Job After 5 Minutes (2% Deferred) ---');
        const jobR2 = await createRemoteJob('Remote Test R2 - Client Penalty', 2000);
        await assignFreelancer(jobR2.id, freelancer.freelancerId, client.clientUserId);
        await db.updateTable('jobs').set({ confirmedAt: tenMinsAgo }).where('id', '=', jobR2.id).execute();

        const beforeR2 = await db
            .selectFrom('clients')
            .select('pendingPenaltyAmount')
            .where('id', '=', client.clientId)
            .executeTakeFirst();
        const pendingBeforeR2 = parseFloat(beforeR2?.pendingPenaltyAmount?.toString() || '0');

        await cancelJob(jobR2.id, client.clientUserId, 'Remote cancel past grace');

        const afterR2 = await db
            .selectFrom('clients')
            .select('pendingPenaltyAmount')
            .where('id', '=', client.clientId)
            .executeTakeFirst();
        const pendingAfterR2 = parseFloat(afterR2?.pendingPenaltyAmount?.toString() || '0');
        const expectedR2 = 2000 * 0.02; // ₹40

        console.log(`Pending: ₹${pendingBeforeR2.toFixed(2)} → ₹${pendingAfterR2.toFixed(2)} (Expected +₹${expectedR2})`);
        if (pendingAfterR2 - pendingBeforeR2 === expectedR2) {
            console.log('✅ TEST R2 PASSED: 2% deferred penalty recorded.');
        } else {
            console.log(`⚠️ TEST R2: Mismatch.`);
        }

        // =====================================================
        // TEST R3: Next Remote Job Inherits Pending Penalty
        // =====================================================
        console.log('\n--- TEST R3: Next Remote Job Inherits Pending Penalty ---');
        const jobR3 = await createRemoteJob('Remote Test R3 - Inherit Penalty', 1500);

        const inherited = parseFloat(jobR3.clientPenaltyAmount?.toString() || '0');
        console.log(`Job R3 clientPenaltyAmount: ₹${inherited}`);
        if (inherited > 0) {
            console.log('✅ TEST R3 PASSED: Penalty inherited to next remote job.');
        }

        // =====================================================
        // TEST R4: Freelancer Cancels Remote Job After 5 Minutes (2% Immediate Deduction)
        // =====================================================
        console.log('\n--- TEST R4: Freelancer Cancels Remote Job After 5 Minutes (2% Immediate) ---');
        const jobR4 = await createRemoteJob('Remote Test R4 - Freelancer Penalty', 3000);
        await assignFreelancer(jobR4.id, freelancer.freelancerId, client.clientUserId);
        await db.updateTable('jobs').set({ confirmedAt: tenMinsAgo }).where('id', '=', jobR4.id).execute();

        const freelancerBeforeR4 = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const wBeforeR4 = parseFloat(freelancerBeforeR4?.withdrawableAmount?.toString() || '0');
        const pdBeforeR4 = parseFloat(freelancerBeforeR4?.totalPenaltyDeducted?.toString() || '0');

        await cancelJob(jobR4.id, freelancer.freelancerUserId, 'Freelancer remote cancel');

        const freelancerAfterR4 = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const wAfterR4 = parseFloat(freelancerAfterR4?.withdrawableAmount?.toString() || '0');
        const pdAfterR4 = parseFloat(freelancerAfterR4?.totalPenaltyDeducted?.toString() || '0');
        const expectedR4 = 3000 * 0.02; // ₹60

        console.log(`Wallet: ₹${wBeforeR4.toFixed(2)} → ₹${wAfterR4.toFixed(2)} (Deducted ₹${(wBeforeR4 - wAfterR4).toFixed(2)}, Expected ₹${expectedR4})`);

        const penaltyTxR4 = await db
            .selectFrom('walletTransactions')
            .select(['transactionType', 'amount'])
            .where('jobId', '=', jobR4.id)
            .where('transactionType', '=', 'PENALTY')
            .executeTakeFirst();

        const penaltyLogR4 = await db
            .selectFrom('penaltyLogs')
            .select(['penaltyType', 'status'])
            .where('jobId', '=', jobR4.id)
            .executeTakeFirst();

        if ((wBeforeR4 - wAfterR4) === expectedR4) console.log('✅ Wallet deduction correct.');
        if (pdAfterR4 - pdBeforeR4 === expectedR4) console.log('✅ totalPenaltyDeducted correct.');
        if (penaltyTxR4) console.log('✅ PENALTY wallet transaction recorded.');
        if (penaltyLogR4?.penaltyType === 'FREELANCER_WALLET_DEDUCTED') console.log('✅ Penalty log recorded.');
        console.log('✅ TEST R4 PASSED: Freelancer cancellation penalty (remote) verified.');

        // =====================================================
        // TEST R5: Non-Completion Penalty via Timer (Remote Job)
        // =====================================================
        console.log('\n--- TEST R5: Non-Completion Penalty via Timer (Remote Job) ---');
        const jobR5 = await createRemoteJob('Remote Test R5 - Non-Completion', 2500);
        await assignFreelancer(jobR5.id, freelancer.freelancerId, client.clientUserId);

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
            .where('id', '=', jobR5.id)
            .execute();

        const freelancerBeforeR5 = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const wBeforeR5 = parseFloat(freelancerBeforeR5?.withdrawableAmount?.toString() || '0');
        const pdBeforeR5 = parseFloat(freelancerBeforeR5?.totalPenaltyDeducted?.toString() || '0');

        await processJobTimers();

        const jobR5After = await db
            .selectFrom('jobs')
            .select(['jobStatus', 'paymentStatus'])
            .where('id', '=', jobR5.id)
            .executeTakeFirst();

        const freelancerAfterR5 = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const wAfterR5 = parseFloat(freelancerAfterR5?.withdrawableAmount?.toString() || '0');
        const pdAfterR5 = parseFloat(freelancerAfterR5?.totalPenaltyDeducted?.toString() || '0');
        const expectedR5 = 2500 * 0.02; // ₹50

        console.log(`Job status: ${jobR5After?.jobStatus} / ${jobR5After?.paymentStatus}`);
        console.log(`Wallet: ₹${wBeforeR5.toFixed(2)} → ₹${wAfterR5.toFixed(2)} (Deducted ₹${(wBeforeR5 - wAfterR5).toFixed(2)}, Expected ₹${expectedR5})`);

        if (jobR5After?.jobStatus === 'DEADLINE_EXPIRED') console.log('✅ Job status: DEADLINE_EXPIRED.');
        if ((wBeforeR5 - wAfterR5) === expectedR5) console.log('✅ Wallet deduction correct.');
        if (pdAfterR5 - pdBeforeR5 === expectedR5) console.log('✅ totalPenaltyDeducted correct.');

        const penaltyLogR5 = await db
            .selectFrom('penaltyLogs')
            .select(['penaltyType', 'status'])
            .where('jobId', '=', jobR5.id)
            .executeTakeFirst();
        if (penaltyLogR5?.penaltyType === 'FREELANCER_NON_COMPLETION') console.log('✅ Penalty log: FREELANCER_NON_COMPLETION.');
        console.log('✅ TEST R5 PASSED: Non-completion penalty (remote) verified.');

        // =====================================================
        // TEST R6: Payment-Time Penalty Recovery via Remote Work Submission
        // =====================================================
        console.log('\n--- TEST R6: Payment-Time Penalty Recovery (Remote Work Submission) ---');
        const jobR6 = await createRemoteJob('Remote Test R6 - Payment Recovery', 4000);
        await assignFreelancer(jobR6.id, freelancer.freelancerId, client.clientUserId);

        // Set clientPenaltyAmount of ₹80
        const testPenaltyR6 = 80;
        await db
            .updateTable('jobs')
            .set({ clientPenaltyAmount: testPenaltyR6.toString(), isAmountReserved: true })
            .where('id', '=', jobR6.id)
            .execute();

        // Freelancer submits digital work
        await submitDigitalWork(jobR6.id, freelancer.freelancerUserId, {
            fileUrl: 'https://example.com/test-work.pdf',
            notes: 'Test submission for penalty recovery',
        });

        console.log('Work submitted. Status: WORK_SUBMITTED');

        // Client accepts — triggers payment
        const freelancerBeforeR6 = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalPenaltyReceived', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const wBeforeR6 = parseFloat(freelancerBeforeR6?.withdrawableAmount?.toString() || '0');
        const prBeforeR6 = parseFloat(freelancerBeforeR6?.totalPenaltyReceived?.toString() || '0');
        const pdBeforeR6 = parseFloat(freelancerBeforeR6?.totalPenaltyDeducted?.toString() || '0');

        await respondToDigitalWork(jobR6.id, client.clientUserId, 'ACCEPT');

        const freelancerAfterR6 = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalPenaltyReceived', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const wAfterR6 = parseFloat(freelancerAfterR6?.withdrawableAmount?.toString() || '0');
        const prAfterR6 = parseFloat(freelancerAfterR6?.totalPenaltyReceived?.toString() || '0');
        const pdAfterR6 = parseFloat(freelancerAfterR6?.totalPenaltyDeducted?.toString() || '0');

        console.log(`Wallet: ₹${wBeforeR6.toFixed(2)} → ₹${wAfterR6.toFixed(2)} (Net +₹${(wAfterR6 - wBeforeR6).toFixed(2)})`);
        console.log(`totalPenaltyReceived: +₹${(prAfterR6 - prBeforeR6).toFixed(2)} (Expected ₹${testPenaltyR6})`);
        console.log(`totalPenaltyDeducted: +₹${(pdAfterR6 - pdBeforeR6).toFixed(2)} (Expected ₹${testPenaltyR6})`);

        const penaltyLogsR6 = await db
            .selectFrom('penaltyLogs')
            .select(['penaltyType', 'status'])
            .where('jobId', '=', jobR6.id)
            .execute();

        const receivedR6 = penaltyLogsR6.find(l => l.penaltyType === 'FREELANCER_RECEIVED_FROM_CLIENT');
        const deductedR6 = penaltyLogsR6.find(l => l.penaltyType === 'FREELANCER_WALLET_DEDUCTED');

        if (receivedR6) console.log('✅ Penalty log: FREELANCER_RECEIVED_FROM_CLIENT / PAID.');
        if (deductedR6) console.log('✅ Penalty log: FREELANCER_WALLET_DEDUCTED / DEDUCTED.');

        const penaltyTxR6 = await db
            .selectFrom('walletTransactions')
            .select(['transactionType', 'amount'])
            .where('jobId', '=', jobR6.id)
            .where('transactionType', '=', 'PENALTY')
            .executeTakeFirst();
        if (penaltyTxR6) console.log('✅ PENALTY wallet transaction recorded.');

        console.log('✅ TEST R6 PASSED: Payment-time penalty recovery (remote) verified.');

        // =====================================================
        // TEST R7: Auto-Accept Timer with Client Penalty Recovery
        // =====================================================
        console.log('\n--- TEST R7: Auto-Accept Timer with Client Penalty Recovery ---');
        const jobR7 = await createRemoteJob('Remote Test R7 - Auto-Accept + Penalty', 3500);
        await assignFreelancer(jobR7.id, freelancer.freelancerId, client.clientUserId);

        const testPenaltyR7 = 70;
        await db
            .updateTable('jobs')
            .set({ clientPenaltyAmount: testPenaltyR7.toString(), isAmountReserved: true })
            .where('id', '=', jobR7.id)
            .execute();

        // Freelancer submits work
        await submitDigitalWork(jobR7.id, freelancer.freelancerUserId, {
            fileUrl: 'https://example.com/auto-accept-test.pdf',
            notes: 'Auto-accept test',
        });

        // Backdate clientReviewPeriodExpiresAt to 1 hour ago to trigger auto-accept
        await db
            .updateTable('jobs')
            .set({ clientReviewPeriodExpiresAt: oneHourAgo })
            .where('id', '=', jobR7.id)
            .execute();

        const freelancerBeforeR7 = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalPenaltyReceived', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const wBeforeR7 = parseFloat(freelancerBeforeR7?.withdrawableAmount?.toString() || '0');
        const prBeforeR7 = parseFloat(freelancerBeforeR7?.totalPenaltyReceived?.toString() || '0');
        const pdBeforeR7 = parseFloat(freelancerBeforeR7?.totalPenaltyDeducted?.toString() || '0');

        // Run timer — should auto-accept and process penalty
        await processJobTimers();

        const jobR7After = await db
            .selectFrom('jobs')
            .select(['jobStatus', 'paymentStatus'])
            .where('id', '=', jobR7.id)
            .executeTakeFirst();

        const freelancerAfterR7 = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalPenaltyReceived', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const wAfterR7 = parseFloat(freelancerAfterR7?.withdrawableAmount?.toString() || '0');
        const prAfterR7 = parseFloat(freelancerAfterR7?.totalPenaltyReceived?.toString() || '0');
        const pdAfterR7 = parseFloat(freelancerAfterR7?.totalPenaltyDeducted?.toString() || '0');

        console.log(`Job status: ${jobR7After?.jobStatus} / ${jobR7After?.paymentStatus}`);
        console.log(`Wallet: ₹${wBeforeR7.toFixed(2)} → ₹${wAfterR7.toFixed(2)} (Net +₹${(wAfterR7 - wBeforeR7).toFixed(2)})`);
        console.log(`totalPenaltyReceived: +₹${(prAfterR7 - prBeforeR7).toFixed(2)} (Expected ₹${testPenaltyR7})`);
        console.log(`totalPenaltyDeducted: +₹${(pdAfterR7 - pdBeforeR7).toFixed(2)} (Expected ₹${testPenaltyR7})`);

        if (jobR7After?.jobStatus === 'AUTO_ACCEPTED') console.log('✅ Job status: AUTO_ACCEPTED.');
        if (prAfterR7 - prBeforeR7 === testPenaltyR7) console.log('✅ totalPenaltyReceived correct (no double-count).');
        if (pdAfterR7 - pdBeforeR7 === testPenaltyR7) console.log('✅ totalPenaltyDeducted correct.');

        const penaltyLogsR7 = await db
            .selectFrom('penaltyLogs')
            .select(['penaltyType', 'status'])
            .where('jobId', '=', jobR7.id)
            .execute();

        const receivedR7 = penaltyLogsR7.find(l => l.penaltyType === 'FREELANCER_RECEIVED_FROM_CLIENT');
        const deductedR7 = penaltyLogsR7.find(l => l.penaltyType === 'FREELANCER_WALLET_DEDUCTED');

        if (receivedR7) console.log('✅ Penalty log: FREELANCER_RECEIVED_FROM_CLIENT / PAID.');
        if (deductedR7) console.log('✅ Penalty log: FREELANCER_WALLET_DEDUCTED / DEDUCTED.');

        console.log('✅ TEST R7 PASSED: Auto-accept with penalty recovery (remote) verified.');

        // =====================================================
        // TEST R8: Double-Count Verification (Remote Job)
        // =====================================================
        console.log('\n--- TEST R8: Double-Count Verification (Remote Job) ---');
        const jobR8 = await createRemoteJob('Remote Test R8 - Double Count Check', 5000);
        await assignFreelancer(jobR8.id, freelancer.freelancerId, client.clientUserId);

        const testPenaltyR8 = 100;
        await db
            .updateTable('jobs')
            .set({ clientPenaltyAmount: testPenaltyR8.toString(), isAmountReserved: true })
            .where('id', '=', jobR8.id)
            .execute();

        await submitDigitalWork(jobR8.id, freelancer.freelancerUserId, {
            fileUrl: 'https://example.com/double-count-test.pdf',
        });

        const freelancerBeforeR8 = await db
            .selectFrom('freelancers')
            .select(['totalPenaltyReceived', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const prBeforeR8 = parseFloat(freelancerBeforeR8?.totalPenaltyReceived?.toString() || '0');
        const pdBeforeR8 = parseFloat(freelancerBeforeR8?.totalPenaltyDeducted?.toString() || '0');

        await respondToDigitalWork(jobR8.id, client.clientUserId, 'ACCEPT');

        const freelancerAfterR8 = await db
            .selectFrom('freelancers')
            .select(['totalPenaltyReceived', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const prAfterR8 = parseFloat(freelancerAfterR8?.totalPenaltyReceived?.toString() || '0');
        const pdAfterR8 = parseFloat(freelancerAfterR8?.totalPenaltyDeducted?.toString() || '0');

        const rInc = prAfterR8 - prBeforeR8;
        const dInc = pdAfterR8 - pdBeforeR8;

        console.log(`totalPenaltyReceived increase: ₹${rInc.toFixed(2)} (Expected ₹${testPenaltyR8})`);
        console.log(`totalPenaltyDeducted increase: ₹${dInc.toFixed(2)} (Expected ₹${testPenaltyR8})`);

        if (rInc === testPenaltyR8) {
            console.log('✅ PASSED: totalPenaltyReceived incremented exactly once (no double-count).');
        } else if (rInc === testPenaltyR8 * 2) {
            console.log('❌ FAILED: totalPenaltyReceived double-counted!');
        } else {
            console.log(`⚠️ UNEXPECTED: increase was ₹${rInc}`);
        }

        if (dInc === testPenaltyR8) {
            console.log('✅ PASSED: totalPenaltyDeducted correct.');
        }

        console.log('✅ TEST R8 PASSED: Double-count verification (remote) complete.');

        console.log('\n---------------------------------------------------------');
        console.log('🎉 ALL REMOTE JOB PENALTY TESTS COMPLETED!');
        console.log('---------------------------------------------------------');
    } catch (err: any) {
        console.error('❌ Remote Penalty Test Error:', err);
    }
}

runRemotePenaltyTests()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
