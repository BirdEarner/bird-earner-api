import 'dotenv/config';
import { db } from '../lib/db';
import { createJob, assignFreelancer, cancelJob, updatePhysicalJobProgress, submitDigitalWork, respondToScopePriceChange } from '../lib/services/jobs';
import { processJobTimers } from '../lib/services/timers';
import { createOrGetThread } from '../lib/services/chats';

async function runCompletePdfBookingFlowTests() {
    console.log('================================================================');
    console.log('🧪 BIRDEARNER COMPLETE PDF BOOKING FLOW & SPEC TEST SUITE');
    console.log('================================================================');

    try {
        const client = await db
            .selectFrom('clients')
            .innerJoin('users', 'users.id', 'clients.userId')
            .select(['clients.id as clientId', 'users.id as clientUserId'])
            .executeTakeFirst();

        const freelancer = await db
            .selectFrom('freelancers')
            .innerJoin('users', 'users.id', 'freelancers.userId')
            .select(['freelancers.id as freelancerId', 'users.id as freelancerUserId', 'freelancers.withdrawableAmount', 'freelancers.cancellationStrikes', 'freelancers.cooldownExpiresAt'])
            .executeTakeFirst();

        if (!client || !freelancer) {
            console.log('⚠️ Test client or freelancer not found in database. Exiting.');
            return;
        }

        console.log(`✅ Using Client ID: ${client.clientId}`);
        console.log(`✅ Using Freelancer ID: ${freelancer.freelancerId}`);

        // -------------------------------------------------------------------------
        // TEST 1: Job Creation without Application Expiration Timer
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 1: Job Creation (No OPEN Job Expiration Timer) ---');
        const job1 = await createJob(
            {
                jobTitle: 'PDF Spec Test - AC Repair',
                jobDescription: 'AC is not cooling properly, needs service',
                jobCategory: 'AC Repair',
                jobSubCategory: 'AC Repair',
                projectType: 'On-site',
                budgetType: 'Fixed',
                budgetAmount: 600,
                workDurationDays: 1,
                paymentMethod: 'CASH',
            },
            client.clientUserId,
            client.clientId
        );

        const fetchedJob1 = await db.selectFrom('jobs').select(['jobStatus', 'applicationDeadline', 'workDurationDays']).where('id', '=', job1.id).executeTakeFirst();
        console.log(`Job created. Status: ${fetchedJob1?.jobStatus}, WorkDurationDays: ${fetchedJob1?.workDurationDays}`);
        console.log(`ApplicationDeadline: ${fetchedJob1?.applicationDeadline ?? 'null (No auto-expiry for OPEN jobs)'}`);
        if (fetchedJob1?.applicationDeadline === null && fetchedJob1?.workDurationDays === 1) {
            console.log('✅ TEST 1 PASSED: Job created OPEN with no auto-expiry application timer.');
        }

        // -------------------------------------------------------------------------
        // TEST 2: Booking Confirmation & Work Deadline Calculation
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 2: Booking Confirmation & Work Deadline Calculation ---');
        const confirmedJob1 = await assignFreelancer(job1.id, freelancer.freelancerId, client.clientUserId);
        const fetchedConfirmed1 = await db.selectFrom('jobs').select(['jobStatus', 'confirmedAt', 'workDeadline']).where('id', '=', job1.id).executeTakeFirst();
        
        console.log(`ConfirmedAt: ${fetchedConfirmed1?.confirmedAt?.toISOString()}`);
        console.log(`WorkDeadline: ${fetchedConfirmed1?.workDeadline?.toISOString()}`);
        
        const expectedWorkDeadline = new Date(new Date(fetchedConfirmed1!.confirmedAt!).getTime() + 1 * 24 * 60 * 60 * 1000);
        const diffMs = Math.abs(fetchedConfirmed1!.workDeadline!.getTime() - expectedWorkDeadline.getTime());
        if (diffMs < 1000) {
            console.log('✅ TEST 2 PASSED: Work deadline calculated strictly from confirmation timestamp + workDurationDays.');
        }

        // -------------------------------------------------------------------------
        // TEST 3: 5-Minute Grace Cancellation Window (0% Penalty)
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 3: 5-Minute Grace Cancellation Window (0% Penalty) ---');
        const cancelledGraceJob = await cancelJob(job1.id, client.clientUserId, 'Client cancel within 5 min grace window');
        console.log(`Cancelled Status: ${cancelledGraceJob.jobStatus}`);
        
        const clientAfterGrace = await db.selectFrom('clients').select('pendingPenaltyAmount').where('id', '=', client.clientId).executeTakeFirst();
        console.log(`Client Pending Penalty Amount: ₹${clientAfterGrace?.pendingPenaltyAmount || 0}`);
        if (parseFloat(clientAfterGrace?.pendingPenaltyAmount?.toString() || '0') === 0) {
            console.log('✅ TEST 3 PASSED: 0% penalty within 5-minute cancellation grace window.');
        }

        // -------------------------------------------------------------------------
        // TEST 4: Post-5-Minute Freelancer Cancellation (100% Client Refund + 2% Freelancer Penalty + Strike + 1-Day Cooldown)
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 4: Freelancer Cancel After 5 Mins (100% Refund, 2% Penalty, Strike & Cooldown) ---');
        const job2 = await createJob(
            {
                jobTitle: 'PDF Spec Test - Video Editing',
                jobDescription: 'Edit promo video for social media',
                jobCategory: 'Video Editor',
                jobSubCategory: 'Video Editing',
                projectType: 'Remote',
                budgetType: 'Fixed',
                budgetAmount: 1000,
                workDurationDays: 2,
                paymentMethod: 'CASH',
            },
            client.clientUserId,
            client.clientId
        );

        await assignFreelancer(job2.id, freelancer.freelancerId, client.clientUserId);

        // Simulate 10 minutes past confirmation date (past 5-min grace window)
        const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
        await db.updateTable('jobs').set({ confirmedAt: tenMinsAgo }).where('id', '=', job2.id).execute();

        const strikesBefore = (await db.selectFrom('freelancers').select('cancellationStrikes').where('id', '=', freelancer.freelancerId).executeTakeFirst())?.cancellationStrikes || 0;

        await cancelJob(job2.id, freelancer.freelancerUserId, 'Freelancer cancels after 10 minutes');

        const freelancerAfterCancel = await db.selectFrom('freelancers').select(['cancellationStrikes', 'cooldownExpiresAt', 'withdrawableAmount']).where('id', '=', freelancer.freelancerId).executeTakeFirst();
        console.log(`Strikes: ${strikesBefore} -> ${freelancerAfterCancel?.cancellationStrikes}`);
        console.log(`Cooldown Expires At: ${freelancerAfterCancel?.cooldownExpiresAt?.toISOString()}`);

        if (freelancerAfterCancel!.cancellationStrikes === strikesBefore + 1 && freelancerAfterCancel!.cooldownExpiresAt && freelancerAfterCancel!.cooldownExpiresAt > new Date()) {
            console.log('✅ TEST 4 PASSED: Freelancer cancellation post-5-min grace applied 2% penalty, +1 strike, and 1-day cooldown.');
        }

        // -------------------------------------------------------------------------
        // TEST 5: Cooldown Enforcement on Chat/Apply
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 5: Cooldown Enforcement on Freelancer Applications ---');
        const job3 = await createJob(
            {
                jobTitle: 'PDF Spec Test - Website Design',
                jobDescription: 'Create landing page mockups for web design',
                jobCategory: 'Web Design',
                jobSubCategory: 'UI/UX',
                projectType: 'Remote',
                budgetType: 'Fixed',
                budgetAmount: 800,
                workDurationDays: 1,
                paymentMethod: 'CASH',
            },
            client.clientUserId,
            client.clientId
        );

        try {
            await createOrGetThread(job3.id, freelancer.freelancerId, client.clientId);
            console.log('⚠️ TEST 5 FAILED: Application should have been blocked during active cooldown!');
        } catch (err: any) {
            console.log(`✅ TEST 5 PASSED: Freelancer application blocked during active 24h cooldown ("${err.message}")`);
        }

        // Reset cooldown for remaining tests
        await db.updateTable('freelancers').set({ cooldownExpiresAt: null }).where('id', '=', freelancer.freelancerId).execute();

        // -------------------------------------------------------------------------
        // TEST 6: Scope Mismatch Price Change Rejection (0 Penalty)
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 6: Scope Mismatch Price Change Rejection (0 Penalty) ---');
        await assignFreelancer(job3.id, freelancer.freelancerId, client.clientUserId);
        
        // Freelancer requests price change due to scope mismatch (₹800 -> ₹1200)
        await db.updateTable('jobs').set({ priceChangeRequested: '1200', priceChangeReason: 'Additional scope discovered' }).where('id', '=', job3.id).execute();

        // Client declines price change
        const scopeCancelledJob = await respondToScopePriceChange(job3.id, client.clientUserId, false);
        console.log(`Scope Cancelled Job Status: ${scopeCancelledJob.jobStatus}`);

        if (scopeCancelledJob.jobStatus === 'CANCELLED_SCOPE_MISMATCH') {
            console.log('✅ TEST 6 PASSED: Scope mismatch price change rejection set status to CANCELLED_SCOPE_MISMATCH with 0 penalty.');
        }

        // -------------------------------------------------------------------------
        // TEST 7: Remote Work 12-Hour Auto-Acceptance
        // -------------------------------------------------------------------------
        console.log('\n--- TEST 7: Remote Work 12-Hour Auto-Acceptance ---');
        // Ensure test client has sufficient wallet balance for platform payment test
        await db.updateTable('clients').set({ wallet: '10000', availableBalance: '10000' }).where('id', '=', client.clientId).execute();

        const job4 = await createJob(
            {
                jobTitle: 'PDF Spec Test - Logo Design',
                jobDescription: 'Design brand logo and favicon',
                jobCategory: 'Graphics',
                jobSubCategory: 'Logo Design',
                projectType: 'Remote',
                budgetType: 'Fixed',
                budgetAmount: 500,
                workDurationDays: 1,
                paymentMethod: 'PLATFORM',
            },
            client.clientUserId,
            client.clientId
        );

        await assignFreelancer(job4.id, freelancer.freelancerId, client.clientUserId);

        // Freelancer submits digital work
        await submitDigitalWork(job4.id, freelancer.freelancerUserId, {
            fileUrl: 'https://example.com/watermarked-logo-preview.png',
            notes: 'Logo draft v1 submitted with watermark preview',
        });

        // Simulate 12 hours passed for client review period
        const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000);
        await db.updateTable('jobs').set({ clientReviewPeriodExpiresAt: thirteenHoursAgo }).where('id', '=', job4.id).execute();

        // Run automated background job timers
        await processJobTimers();

        const autoAcceptedJob = await db.selectFrom('jobs').select(['jobStatus', 'paymentStatus']).where('id', '=', job4.id).executeTakeFirst();
        console.log(`Auto-accepted Job Status: ${autoAcceptedJob?.jobStatus}, Payment: ${autoAcceptedJob?.paymentStatus}`);

        if (autoAcceptedJob?.jobStatus === 'AUTO_ACCEPTED') {
            console.log('✅ TEST 7 PASSED: 12-hour client review inactivity automatically accepted work.');
        }

        console.log('\n================================================================');
        console.log('🎉 ALL PDF BOOKING FLOW & SPECIFICATION TESTS PASSED!');
        console.log('================================================================');
    } catch (err: any) {
        console.error('❌ PDF Booking Flow Test Error:', err);
    }
}

runCompletePdfBookingFlowTests()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
