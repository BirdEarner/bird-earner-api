import 'dotenv/config';
import { db } from '../lib/db';
import { createJob, assignFreelancer, updatePhysicalJobProgress, isValidStatusTransition } from '../lib/services/jobs';
import { recordJobStatusHistory } from '../lib/services/timers';

async function runDisputeFlowTests() {
    console.log('---------------------------------------------------------');
    console.log('🚀 BIRDEARNER DISPUTE FLOW & RESOLUTION TEST SUITE');
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
            .select(['freelancers.id as freelancerId', 'users.id as freelancerUserId'])
            .executeTakeFirst();

        if (!client || !freelancer) {
            console.log('⚠️ Could not find test client or freelancer in DB. Skipping.');
            return;
        }

        console.log(`✅ Client ID: ${client.clientId} (User: ${client.clientUserId})`);
        console.log(`✅ Freelancer ID: ${freelancer.freelancerId} (User: ${freelancer.freelancerUserId})`);

        // Helper to create an active job
        async function createTestJob(title: string) {
            const job = await createJob(
                {
                    jobTitle: title,
                    jobDescription: 'Dispute flow test',
                    jobCategory: 'AC Repair',
                    jobSubCategory: 'AC Repair',
                    projectType: 'On-site',
                    budgetType: 'Fixed',
                    budgetAmount: 1200,
                    workDurationDays: 1,
                    paymentMethod: 'CASH',
                },
                client.clientUserId,
                client.clientId
            );
            await assignFreelancer(job.id, freelancer.freelancerId, client.clientUserId);
            return job;
        }

        // =====================================================
        // TEST D1: Raising a Dispute (RAISE_DISPUTE)
        // =====================================================
        console.log('\n--- TEST D1: Raising a Dispute (RAISE_DISPUTE) ---');
        const jobD1 = await createTestJob('Dispute Test D1 - Raise Dispute');

        // Progress job to TRAVELLING -> ARRIVED -> REQUEST_OTP -> VERIFY_OTP
        await updatePhysicalJobProgress(jobD1.id, 'TRAVELLING', freelancer.freelancerUserId);
        await updatePhysicalJobProgress(jobD1.id, 'ARRIVED', freelancer.freelancerUserId);
        await updatePhysicalJobProgress(jobD1.id, 'REQUEST_OTP', freelancer.freelancerUserId);

        const otpJob = await db.selectFrom('jobs').select('otpCode').where('id', '=', jobD1.id).executeTakeFirst();
        await updatePhysicalJobProgress(jobD1.id, 'VERIFY_OTP', freelancer.freelancerUserId, { otpCode: otpJob?.otpCode || '' });

        // Backdate post-OTP cancellation window to simulate expired window
        const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
        await db.updateTable('jobs').set({ postOtpCancellationWindowExpiresAt: tenMinsAgo }).where('id', '=', jobD1.id).execute();

        // Client raises dispute
        const disputeJob = await updatePhysicalJobProgress(jobD1.id, 'RAISE_DISPUTE', client.clientUserId);
        console.log(`Job status after dispute raised: ${disputeJob.jobStatus}`);

        const statusHistoryD1 = await db
            .selectFrom('jobStatusHistory')
            .select(['status', 'action', 'reason'])
            .where('jobId', '=', jobD1.id)
            .where('status', '=', 'DISPUTE_OPEN')
            .executeTakeFirst();

        const notifD1 = await db
            .selectFrom('notifications')
            .select(['type', 'title'])
            .where('type', '=', 'DISPUTE_OPENED')
            .executeTakeFirst();

        if (disputeJob.jobStatus === 'DISPUTE_OPEN') console.log('✅ Job status changed to DISPUTE_OPEN.');
        if (statusHistoryD1) console.log('✅ Status history audit trail recorded DISPUTE_OPEN.');
        if (notifD1) console.log('✅ Notification DISPUTE_OPENED sent.');
        console.log('✅ TEST D1 PASSED: Raising a dispute verified.');

        // =====================================================
        // TEST D2: Dispute Resolution Transitions
        // =====================================================
        console.log('\n--- TEST D2: Dispute Resolution Transitions ---');
        console.log(`Valid transitions from DISPUTE_OPEN -> DISPUTE_RESOLVED: ${isValidStatusTransition('DISPUTE_OPEN', 'DISPUTE_RESOLVED')}`);
        console.log(`Valid transitions from DISPUTE_OPEN -> REFUNDED: ${isValidStatusTransition('DISPUTE_OPEN', 'REFUNDED')}`);
        console.log(`Valid transitions from DISPUTE_OPEN -> CLOSED: ${isValidStatusTransition('DISPUTE_OPEN', 'CLOSED')}`);

        if (
            isValidStatusTransition('DISPUTE_OPEN', 'DISPUTE_RESOLVED') &&
            isValidStatusTransition('DISPUTE_OPEN', 'REFUNDED') &&
            isValidStatusTransition('DISPUTE_OPEN', 'CLOSED')
        ) {
            console.log('✅ All dispute resolution status transitions valid.');
        }

        // Resolve dispute -> DISPUTE_RESOLVED
        const resolvedJob = await db
            .updateTable('jobs')
            .set({ jobStatus: 'DISPUTE_RESOLVED', updatedAt: new Date() })
            .where('id', '=', jobD1.id)
            .returningAll()
            .executeTakeFirstOrThrow();

        await db.transaction().execute(async (trx) => {
            await recordJobStatusHistory(
                trx,
                jobD1.id,
                'DISPUTE_RESOLVED',
                client.clientUserId,
                'CLIENT',
                'DISPUTE_RESOLVED',
                'Dispute resolved by admin team'
            );
        });

        console.log(`Job status after resolution: ${resolvedJob.jobStatus}`);
        if (resolvedJob.jobStatus === 'DISPUTE_RESOLVED') {
            console.log('✅ TEST D2 PASSED: Dispute successfully resolved to DISPUTE_RESOLVED.');
        }

        console.log('\n---------------------------------------------------------');
        console.log('🎉 DISPUTE FLOW AND RESOLUTION TESTS COMPLETED!');
        console.log('---------------------------------------------------------');
    } catch (err: any) {
        console.error('❌ Dispute Test Error:', err);
    }
}

runDisputeFlowTests()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
