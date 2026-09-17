import 'dotenv/config';
import { db } from '../lib/db';
import { createJob, assignFreelancer, updatePhysicalJobProgress, completeJob } from '../lib/services/jobs';

async function main() {
    console.log('--- STARTING ON-SITE SCOPE MISMATCH WORKFLOW TEST ---');

    // Find test client and freelancer
    const clientUser = await db
        .selectFrom('users')
        .innerJoin('clients', 'clients.userId', 'users.id')
        .select(['users.id as userId', 'clients.id as clientId', 'users.email'])
        .executeTakeFirst();

    const freelancerUser = await db
        .selectFrom('users')
        .innerJoin('freelancers', 'freelancers.userId', 'users.id')
        .select(['users.id as userId', 'freelancers.id as freelancerId', 'users.email'])
        .executeTakeFirst();

    if (!clientUser || !freelancerUser) {
        console.error('Test users not found');
        process.exit(1);
    }

    console.log(`Client: ${clientUser.email} (ID: ${clientUser.clientId})`);
    console.log(`Freelancer: ${freelancerUser.email} (ID: ${freelancerUser.freelancerId})`);

    // Ensure client has sufficient wallet balance for platform test
    await db.updateTable('clients').set({ wallet: '1000' }).where('id', '=', clientUser.clientId).execute();

    // -------------------------------------------------------------
    // TEST 1: PLATFORM PAYMENT JOB - Scope Mismatch Cancellation
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Platform Payment Job Scope Mismatch Flow ---');
    const platformJob = await createJob({
        jobTitle: 'On-site AC Repair Platform Test',
        jobDescription: 'AC is not cooling',
        jobCategory: 'AC Repair',
        jobSubCategory: 'General AC',
        budgetType: 'FIXED',
        budgetAmount: '100',
        projectType: 'On-site',
        paymentMethod: 'PLATFORM',
        location: 'Test Location',
    }, clientUser.userId, clientUser.clientId);

    console.log(`1. Created Platform Job: ${platformJob.id} (Status: ${platformJob.jobStatus}, Reserved: ${platformJob.isAmountReserved})`);

    // Assign freelancer
    await assignFreelancer(platformJob.id, freelancerUser.freelancerId, '100');
    console.log('2. Freelancer assigned.');

    // Progress: Travelling -> Arrived -> Verify OTP
    await updatePhysicalJobProgress(platformJob.id, 'TRAVELLING', freelancerUser.userId);
    await updatePhysicalJobProgress(platformJob.id, 'ARRIVED', freelancerUser.userId);

    const otpJob = await db.selectFrom('jobs').select('otpCode').where('id', '=', platformJob.id).executeTakeFirst();
    await updatePhysicalJobProgress(platformJob.id, 'VERIFY_OTP', freelancerUser.userId, { otpCode: otpJob?.otpCode || '' });
    console.log('3. OTP verified -> Job status is now JOB_STARTED.');

    // Attempt Scope Mismatch without reason -> Should FAIL
    try {
        await updatePhysicalJobProgress(platformJob.id, 'CANCEL_SCOPE_MISMATCH', freelancerUser.userId, { reason: '   ' });
        console.error('❌ TEST FAILED: Scope mismatch without reason was allowed!');
        process.exit(1);
    } catch (err: any) {
        console.log(`✅ Mandatory reason validation passed: "${err.message}"`);
    }

    // Attempt Scope Mismatch with valid reason -> Should SUCCEED
    const scopeReason = 'Major compressor replacement required which was not in description';
    const cancelledPlatformJob = await updatePhysicalJobProgress(platformJob.id, 'CANCEL_SCOPE_MISMATCH', freelancerUser.userId, { reason: scopeReason });

    console.log(`4. Scope mismatch submitted: Status = ${cancelledPlatformJob.jobStatus}, Reason = ${cancelledPlatformJob.cancellationReason}`);

    if (cancelledPlatformJob.jobStatus !== 'CANCELLED_SCOPE_MISMATCH') {
        console.error('❌ TEST FAILED: Job status is not CANCELLED_SCOPE_MISMATCH');
        process.exit(1);
    }

    // Verify reserved amount released
    const updatedPlatformJob = await db.selectFrom('jobs').select('isAmountReserved').where('id', '=', platformJob.id).executeTakeFirst();
    if (updatedPlatformJob?.isAmountReserved) {
        console.error('❌ TEST FAILED: Amount is still reserved after scope mismatch cancellation');
        process.exit(1);
    }
    console.log('✅ TEST 1 PASSED: Platform job cancelled with 0 penalty, 100% reserved amount released.');

    // Attempt duplicate Scope Mismatch on same job -> Should FAIL
    try {
        await updatePhysicalJobProgress(platformJob.id, 'CANCEL_SCOPE_MISMATCH', freelancerUser.userId, { reason: 'Retry' });
        console.error('❌ TEST FAILED: Duplicate cancellation allowed!');
        process.exit(1);
    } catch (err: any) {
        console.log(`✅ Retry protection passed: "${err.message}"`);
    }

    // Attempt job completion after cancellation -> Should FAIL
    try {
        await completeJob(platformJob.id, clientUser.userId);
        console.error('❌ TEST FAILED: Completion allowed on cancelled job!');
        process.exit(1);
    } catch (err: any) {
        console.log(`✅ Completion attempt protection passed: "${err.message}"`);
    }

    // -------------------------------------------------------------
    // TEST 2: CASH PAYMENT JOB - Scope Mismatch & Penalty Carry-Forward
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Cash Payment Job & Client Penalty Carry-Forward ---');

    // Attach dummy client penalty amount to test carry forward
    await db.updateTable('clients').set({ pendingPenaltyAmount: '0' }).where('id', '=', clientUser.clientId).execute();

    const cashJob = await createJob({
        jobTitle: 'On-site Plumbing Cash Test',
        jobDescription: 'Pipe leak fix',
        jobCategory: 'Plumbing',
        jobSubCategory: 'Leak Repair',
        budgetType: 'FIXED',
        budgetAmount: '200',
        projectType: 'On-site',
        paymentMethod: 'CASH',
        location: 'Test Location',
    }, clientUser.userId, clientUser.clientId);

    // Manually set clientPenaltyAmount on cashJob to simulate outstanding penalty attached to this job
    await db.updateTable('jobs').set({ clientPenaltyAmount: '15' }).where('id', '=', cashJob.id).execute();

    console.log(`1. Created Cash Job: ${cashJob.id} with attached penalty: ₹15`);

    // Assign freelancer -> Travelling -> Arrived -> Verify OTP
    await assignFreelancer(cashJob.id, freelancerUser.freelancerId, '200');
    await updatePhysicalJobProgress(cashJob.id, 'TRAVELLING', freelancerUser.userId);
    await updatePhysicalJobProgress(cashJob.id, 'ARRIVED', freelancerUser.userId);

    const cashOtpJob = await db.selectFrom('jobs').select('otpCode').where('id', '=', cashJob.id).executeTakeFirst();
    await updatePhysicalJobProgress(cashJob.id, 'VERIFY_OTP', freelancerUser.userId, { otpCode: cashOtpJob?.otpCode || '' });
    console.log('2. OTP verified for Cash job.');

    // Cancel Cash job for Scope Mismatch
    const cancelledCashJob = await updatePhysicalJobProgress(cashJob.id, 'CANCEL_SCOPE_MISMATCH', freelancerUser.userId, { reason: 'Wall piping completely damaged, requires main line overhaul' });

    console.log(`3. Cash Job cancelled: Status = ${cancelledCashJob.jobStatus}`);

    // Verify attached penalty was carried forward to client.pendingPenaltyAmount
    const clientRecord = await db.selectFrom('clients').select('pendingPenaltyAmount').where('id', '=', clientUser.clientId).executeTakeFirst();
    console.log(`4. Client pending penalty balance: ₹${clientRecord?.pendingPenaltyAmount}`);

    if (parseFloat(clientRecord?.pendingPenaltyAmount || '0') !== 15) {
        console.error('❌ TEST FAILED: Outstanding penalty was not carried forward to client record!');
        process.exit(1);
    }
    console.log('✅ TEST 2 PASSED: Cash job cancelled, 0 cash collected, attached penalty carried forward to client profile.');

    // -------------------------------------------------------------
    // TEST 3: Pre-OTP Scope Mismatch Attempt -> Should be BLOCKED
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Scope Mismatch Before OTP Verification ---');
    const preOtpJob = await createJob({
        jobTitle: 'On-site Pre-OTP Test',
        jobDescription: 'Electrical issue',
        jobCategory: 'Electrical',
        jobSubCategory: 'Wiring',
        budgetType: 'FIXED',
        budgetAmount: '150',
        projectType: 'On-site',
        paymentMethod: 'PLATFORM',
        location: 'Test Location',
    }, clientUser.userId, clientUser.clientId);

    await assignFreelancer(preOtpJob.id, freelancerUser.freelancerId, '150');

    try {
        await updatePhysicalJobProgress(preOtpJob.id, 'CANCEL_SCOPE_MISMATCH', freelancerUser.userId, { reason: 'Attempt before OTP' });
        console.error('❌ TEST FAILED: Pre-OTP scope mismatch cancellation was allowed!');
        process.exit(1);
    } catch (err: any) {
        console.log(`✅ Pre-OTP scope mismatch protection passed: "${err.message}"`);
    }

    // Cleanup test jobs and child records
    const jobIds = [preOtpJob.id, platformJob.id, cashJob.id];
    await db.deleteFrom('penaltyLogs').where('jobId', 'in', jobIds).execute();
    await db.deleteFrom('jobStatusHistory').where('jobId', 'in', jobIds).execute();
    await db.deleteFrom('walletTransactions').where('jobId', 'in', jobIds).execute();
    await db.deleteFrom('messages').where('jobId', 'in', jobIds).execute();
    await db.deleteFrom('chatThreads').where('jobId', 'in', jobIds).execute();
    await db.deleteFrom('jobs').where('id', 'in', jobIds).execute();

    console.log('\n======================================================');
    console.log('🎉 ALL ON-SITE SCOPE MISMATCH TESTS PASSED SUCCESSFULLY!');
    console.log('======================================================');
    process.exit(0);
}

main().catch(err => {
    console.error('Test execution error:', err);
    process.exit(1);
});
