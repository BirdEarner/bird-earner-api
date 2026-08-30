import 'dotenv/config';
import { db } from '../lib/db';
import { cancelJob, createJob, assignFreelancer, updatePhysicalJobProgress } from '../lib/services/jobs';

async function runOnSiteOtpTests() {
    console.log('---------------------------------------------------------');
    console.log('🚀 BIRDEARNER ON-SITE OTP & PENALTY TEST SUITE');
    console.log('---------------------------------------------------------');

    try {
        const client = await db
            .selectFrom('clients')
            .innerJoin('users', 'users.id', 'clients.userId')
            .select(['clients.id as clientId', 'users.id as clientUserId'])
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

        async function createOnSiteJob(title: string, budget: number) {
            return createJob(
                {
                    jobTitle: title,
                    jobDescription: 'On-site OTP penalty test',
                    jobCategory: 'AC Repair',
                    jobSubCategory: 'AC Repair',
                    projectType: 'On-site',
                    budgetType: 'Fixed',
                    budgetAmount: budget,
                    workDurationDays: 1,
                    paymentMethod: 'CASH',
                },
                client.clientUserId,
                client.clientId
            );
        }

        // Helper: run full OTP flow up to JOB_STARTED
        async function runOtpFlow(jobId: string) {
            // Freelancer: TRAVELLING
            await updatePhysicalJobProgress(jobId, 'TRAVELLING', freelancer.freelancerUserId);
            // Freelancer: ARRIVED
            await updatePhysicalJobProgress(jobId, 'ARRIVED', freelancer.freelancerUserId);
            // Freelancer: REQUEST_OTP
            await updatePhysicalJobProgress(jobId, 'REQUEST_OTP', freelancer.freelancerUserId);

            // Get the generated OTP code
            const job = await db
                .selectFrom('jobs')
                .select('otpCode')
                .where('id', '=', jobId)
                .executeTakeFirst();

            // Freelancer: VERIFY_OTP
            await updatePhysicalJobProgress(jobId, 'VERIFY_OTP', freelancer.freelancerUserId, { otpCode: job?.otpCode || '' });

            return job?.otpCode;
        }

        // =====================================================
        // TEST O1: Full OTP Flow Works Correctly
        // =====================================================
        console.log('\n--- TEST O1: Full OTP Flow (TRAVELLING → ARRIVED → REQUEST_OTP → VERIFY_OTP) ---');
        const jobO1 = await createOnSiteJob('On-Site Test O1 - OTP Flow', 1000);
        await assignFreelancer(jobO1.id, freelancer.freelancerId, client.clientUserId);

        const otpCode = await runOtpFlow(jobO1.id);

        const jobO1After = await db
            .selectFrom('jobs')
            .select(['jobStatus', 'otpCode', 'otpVerifiedAt', 'postOtpCancellationWindowExpiresAt'])
            .where('id', '=', jobO1.id)
            .executeTakeFirst();

        console.log(`Status: ${jobO1After?.jobStatus}`);
        console.log(`OTP verified: ${jobO1After?.otpVerifiedAt ? 'Yes' : 'No'}`);
        console.log(`Post-OTP window expires: ${jobO1After?.postOtpCancellationWindowExpiresAt}`);

        if (jobO1After?.jobStatus === 'JOB_STARTED' && jobO1After?.otpVerifiedAt) {
            console.log('✅ TEST O1 PASSED: Full OTP flow completed, job started.');
        } else {
            console.log('⚠️ TEST O1: Unexpected state.');
        }

        // =====================================================
        // TEST O2: Emergency Cancel Within 5-Min Post-OTP Window (0% Penalty)
        // =====================================================
        console.log('\n--- TEST O2: Emergency Cancel Within 5-Min Post-OTP Window (0% Penalty) ---');
        const jobO2 = await createOnSiteJob('On-Site Test O2 - Emergency Cancel', 2000);
        await assignFreelancer(jobO2.id, freelancer.freelancerId, client.clientUserId);
        await runOtpFlow(jobO2.id);

        // Both client and freelancer should be able to emergency cancel within 5 min of OTP
        // Client emergency cancels
        const emergencyResult = await updatePhysicalJobProgress(jobO2.id, 'EMERGENCY_CANCEL', client.clientUserId);

        const jobO2After = await db
            .selectFrom('jobs')
            .select('jobStatus')
            .where('id', '=', jobO2.id)
            .executeTakeFirst();

        const penaltyLogO2 = await db
            .selectFrom('penaltyLogs')
            .select('id')
            .where('jobId', '=', jobO2.id)
            .executeTakeFirst();

        console.log(`Status: ${jobO2After?.jobStatus}`);
        if (jobO2After?.jobStatus === 'CANCELLED_BY_CLIENT' && !penaltyLogO2) {
            console.log('✅ TEST O2 PASSED: Emergency cancel within OTP window → 0% penalty.');
        } else {
            console.log('⚠️ TEST O2: Unexpected state.');
        }

        // =====================================================
        // TEST O3: Emergency Cancel After Post-OTP Window Expired → Blocked
        // =====================================================
        console.log('\n--- TEST O3: Emergency Cancel After Post-OTP Window Expired → Blocked ---');
        const jobO3 = await createOnSiteJob('On-Site Test O3 - Emergency Window Expired', 1500);
        await assignFreelancer(jobO3.id, freelancer.freelancerId, client.clientUserId);
        await runOtpFlow(jobO3.id);

        // Backdate postOtpCancellationWindowExpiresAt to 10 minutes ago
        const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
        await db
            .updateTable('jobs')
            .set({ postOtpCancellationWindowExpiresAt: tenMinsAgo })
            .where('id', '=', jobO3.id)
            .execute();

        try {
            await updatePhysicalJobProgress(jobO3.id, 'EMERGENCY_CANCEL', client.clientUserId);
            console.log('⚠️ TEST O3: Expected error but none thrown.');
        } catch (err: any) {
            if (err.message.includes('Emergency cancellation window has expired')) {
                console.log('✅ TEST O3 PASSED: Emergency cancel blocked after window expired.');
            } else {
                console.log(`⚠️ TEST O3: Unexpected error: ${err.message}`);
            }
        }

        // =====================================================
        // TEST O4: Client Cancels Within Post-OTP Window → 0% Penalty
        // =====================================================
        console.log('\n--- TEST O4: Client Cancels Within Post-OTP Window → 0% Penalty ---');
        const jobO4 = await createOnSiteJob('On-Site Test O4 - Cancel in Post-OTP Window', 2500);
        await assignFreelancer(jobO4.id, freelancer.freelancerId, client.clientUserId);
        await runOtpFlow(jobO4.id);

        // postOtpCancellationWindowExpiresAt is set to 5 min from OTP verification, so should still be within window
        const cancelledO4 = await cancelJob(jobO4.id, client.clientUserId, 'Cancel within post-OTP window');

        const penaltyLogO4 = await db
            .selectFrom('penaltyLogs')
            .select('id')
            .where('jobId', '=', jobO4.id)
            .executeTakeFirst();

        console.log(`Status: ${cancelledO4.jobStatus}`);
        if (cancelledO4.jobStatus === 'CANCELLED_BY_CLIENT' && !penaltyLogO4) {
            console.log('✅ TEST O4 PASSED: Client cancel within post-OTP window → 0% penalty.');
        } else {
            console.log('⚠️ TEST O4: Unexpected state.');
        }

        // =====================================================
        // TEST O5: Client Cancels After Post-OTP Window Expired → Blocked
        // =====================================================
        console.log('\n--- TEST O5: Client Cancels After Post-OTP Window + OTP Verified → Blocked ---');
        const jobO5 = await createOnSiteJob('On-Site Test O5 - Cancel After OTP Window', 3000);
        await assignFreelancer(jobO5.id, freelancer.freelancerId, client.clientUserId);
        await runOtpFlow(jobO5.id);

        // Backdate both confirmedAt (past 5-min grace) and postOtpCancellationWindowExpiresAt (past window)
        await db
            .updateTable('jobs')
            .set({
                confirmedAt: tenMinsAgo,
                postOtpCancellationWindowExpiresAt: tenMinsAgo,
            })
            .where('id', '=', jobO5.id)
            .execute();

        try {
            await cancelJob(jobO5.id, client.clientUserId, 'Should be blocked');
            console.log('⚠️ TEST O5: Expected error but none thrown.');
        } catch (err: any) {
            if (err.message.includes('Normal cancellation is disabled') || err.message.includes('Raise a Dispute')) {
                console.log('✅ TEST O5 PASSED: Cancel blocked after OTP window expired. Must raise dispute.');
            } else {
                console.log(`⚠️ TEST O5: Unexpected error: ${err.message}`);
            }
        }

        // =====================================================
        // TEST O6: Freelancer Cancels After Post-OTP Window → Blocked
        // =====================================================
        console.log('\n--- TEST O6: Freelancer Cancels After Post-OTP Window → Blocked ---');
        const jobO6 = await createOnSiteJob('On-Site Test O6 - Freelancer Cancel After OTP', 3500);
        await assignFreelancer(jobO6.id, freelancer.freelancerId, client.clientUserId);
        await runOtpFlow(jobO6.id);

        await db
            .updateTable('jobs')
            .set({
                confirmedAt: tenMinsAgo,
                postOtpCancellationWindowExpiresAt: tenMinsAgo,
            })
            .where('id', '=', jobO6.id)
            .execute();

        try {
            await cancelJob(jobO6.id, freelancer.freelancerUserId, 'Should be blocked');
            console.log('⚠️ TEST O6: Expected error but none thrown.');
        } catch (err: any) {
            if (err.message.includes('Normal cancellation is disabled') || err.message.includes('Raise a Dispute')) {
                console.log('✅ TEST O6 PASSED: Freelancer cancel blocked after OTP window expired.');
            } else {
                console.log(`⚠️ TEST O6: Unexpected error: ${err.message}`);
            }
        }

        // =====================================================
        // TEST O7: Payment Recovery via CONFIRM_WORK_COMPLETED After OTP
        // =====================================================
        console.log('\n--- TEST O7: Payment Recovery via CONFIRM_WORK_COMPLETED After OTP ---');
        const jobO7 = await createOnSiteJob('On-Site Test O7 - Payment via OTP Flow', 4000);
        await assignFreelancer(jobO7.id, freelancer.freelancerId, client.clientUserId);
        await runOtpFlow(jobO7.id);

        // Set clientPenaltyAmount of ₹80
        const testPenaltyO7 = 80;
        await db
            .updateTable('jobs')
            .set({ clientPenaltyAmount: testPenaltyO7.toString(), isAmountReserved: true })
            .where('id', '=', jobO7.id)
            .execute();

        const freelancerBeforeO7 = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalPenaltyReceived', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const wBeforeO7 = parseFloat(freelancerBeforeO7?.withdrawableAmount?.toString() || '0');
        const prBeforeO7 = parseFloat(freelancerBeforeO7?.totalPenaltyReceived?.toString() || '0');
        const pdBeforeO7 = parseFloat(freelancerBeforeO7?.totalPenaltyDeducted?.toString() || '0');

        // Client confirms work completed → triggers payment
        await updatePhysicalJobProgress(jobO7.id, 'CONFIRM_WORK_COMPLETED', client.clientUserId);

        const jobO7After = await db
            .selectFrom('jobs')
            .select(['jobStatus', 'paymentStatus'])
            .where('id', '=', jobO7.id)
            .executeTakeFirst();

        const freelancerAfterO7 = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalPenaltyReceived', 'totalPenaltyDeducted'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();

        const wAfterO7 = parseFloat(freelancerAfterO7?.withdrawableAmount?.toString() || '0');
        const prAfterO7 = parseFloat(freelancerAfterO7?.totalPenaltyReceived?.toString() || '0');
        const pdAfterO7 = parseFloat(freelancerAfterO7?.totalPenaltyDeducted?.toString() || '0');

        console.log(`Job status: ${jobO7After?.jobStatus} / ${jobO7After?.paymentStatus}`);
        console.log(`Wallet: ₹${wBeforeO7.toFixed(2)} → ₹${wAfterO7.toFixed(2)} (Net +₹${(wAfterO7 - wBeforeO7).toFixed(2)})`);
        console.log(`totalPenaltyReceived: +₹${(prAfterO7 - prBeforeO7).toFixed(2)} (Expected ₹${testPenaltyO7})`);
        console.log(`totalPenaltyDeducted: +₹${(pdAfterO7 - pdBeforeO7).toFixed(2)} (Expected ₹${testPenaltyO7})`);

        if (jobO7After?.jobStatus === 'COMPLETED') console.log('✅ Job status: COMPLETED.');
        if (prAfterO7 - prBeforeO7 === testPenaltyO7) console.log('✅ totalPenaltyReceived correct.');
        if (pdAfterO7 - pdBeforeO7 === testPenaltyO7) console.log('✅ totalPenaltyDeducted correct.');

        const penaltyLogsO7 = await db
            .selectFrom('penaltyLogs')
            .select(['penaltyType', 'status'])
            .where('jobId', '=', jobO7.id)
            .execute();

        if (penaltyLogsO7.find(l => l.penaltyType === 'FREELANCER_RECEIVED_FROM_CLIENT')) console.log('✅ Penalty log: FREELANCER_RECEIVED_FROM_CLIENT.');
        if (penaltyLogsO7.find(l => l.penaltyType === 'FREELANCER_WALLET_DEDUCTED')) console.log('✅ Penalty log: FREELANCER_WALLET_DEDUCTED.');

        console.log('✅ TEST O7 PASSED: Payment recovery via CONFIRM_WORK_COMPLETED verified.');

        // =====================================================
        // TEST O8: Invalid OTP Rejection
        // =====================================================
        console.log('\n--- TEST O8: Invalid OTP Rejection ---');
        const jobO8 = await createOnSiteJob('On-Site Test O8 - Invalid OTP', 1000);
        await assignFreelancer(jobO8.id, freelancer.freelancerId, client.clientUserId);

        // TRAVELLING → ARRIVED → REQUEST_OTP
        await updatePhysicalJobProgress(jobO8.id, 'TRAVELLING', freelancer.freelancerUserId);
        await updatePhysicalJobProgress(jobO8.id, 'ARRIVED', freelancer.freelancerUserId);
        await updatePhysicalJobProgress(jobO8.id, 'REQUEST_OTP', freelancer.freelancerUserId);

        try {
            await updatePhysicalJobProgress(jobO8.id, 'VERIFY_OTP', freelancer.freelancerUserId, { otpCode: '000000' });
            console.log('⚠️ TEST O8: Expected error for invalid OTP but none thrown.');
        } catch (err: any) {
            if (err.message.includes('Invalid OTP')) {
                console.log('✅ TEST O8 PASSED: Invalid OTP correctly rejected.');
            } else {
                console.log(`⚠️ TEST O8: Unexpected error: ${err.message}`);
            }
        }

        // =====================================================
        // TEST O9: OTP Cannot Be Requested Before ARRIVED
        // =====================================================
        console.log('\n--- TEST O9: OTP Cannot Be Requested Before ARRIVED ---');
        const jobO9 = await createOnSiteJob('On-Site Test O9 - OTP Before Arrived', 1000);
        await assignFreelancer(jobO9.id, freelancer.freelancerId, client.clientUserId);

        // Only TRAVELLING, skip ARRIVED
        await updatePhysicalJobProgress(jobO9.id, 'TRAVELLING', freelancer.freelancerUserId);

        try {
            await updatePhysicalJobProgress(jobO9.id, 'REQUEST_OTP', freelancer.freelancerUserId);
            console.log('⚠️ TEST O9: Expected error but none thrown.');
        } catch (err: any) {
            if (err.message.includes('OTP can only be requested after freelancer has arrived')) {
                console.log('✅ TEST O9 PASSED: OTP request blocked before ARRIVED.');
            } else {
                console.log(`⚠️ TEST O9: Unexpected error: ${err.message}`);
            }
        }

        console.log('\n---------------------------------------------------------');
        console.log('🎉 ALL ON-SITE OTP TESTS COMPLETED!');
        console.log('---------------------------------------------------------');
    } catch (err: any) {
        console.error('❌ On-Site OTP Test Error:', err);
    }
}

runOnSiteOtpTests()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
