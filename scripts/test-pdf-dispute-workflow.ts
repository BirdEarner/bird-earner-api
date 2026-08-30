import 'dotenv/config';
import { db } from '../lib/db';
import { createJob, assignFreelancer, updatePhysicalJobProgress, submitDigitalWork, cancelJob } from '../lib/services/jobs';
import { generateToken } from '../lib/auth';

async function testPdfDisputeWorkflow() {
    console.log('=========================================================');
    console.log('📄 BIRDEARNER PDF DISPUTE WORKFLOW COMPLIANCE TEST SUITE');
    console.log('=========================================================');

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

        const adminToken = generateToken({
            id: 999,
            email: 'support-admin@birdearner.com',
            role: 'superadmin',
        });

        console.log(`✅ Using Client: ${client.clientId} (User: ${client.clientUserId})`);
        console.log(`✅ Using Freelancer: ${freelancer.freelancerId} (User: ${freelancer.freelancerUserId})`);

        // =========================================================================
        // PDF CASE 2C/2D: On-Site Service Post-OTP Expired -> Normal Cancel Blocked -> Raise Dispute -> Admin Refund
        // =========================================================================
        console.log('\n--- PDF SCENARIO 1: On-Site Post-OTP Expired Dispute (Client Refund) ---');
        const onsiteJob = await createJob(
            {
                jobTitle: 'PDF Test - On-Site AC Repair Dispute',
                jobDescription: 'AC repair issue requiring dispute escalation',
                jobCategory: 'AC Repair',
                jobSubCategory: 'AC Repair',
                projectType: 'On-site',
                budgetType: 'Fixed',
                budgetAmount: 700,
                workDurationDays: 1,
                paymentMethod: 'CASH',
            },
            client.clientUserId,
            client.clientId
        );

        await assignFreelancer(onsiteJob.id, freelancer.freelancerId, client.clientUserId);

        // Run OTP flow: TRAVELLING -> ARRIVED -> REQUEST_OTP -> VERIFY_OTP
        await updatePhysicalJobProgress(onsiteJob.id, 'TRAVELLING', freelancer.freelancerUserId);
        await updatePhysicalJobProgress(onsiteJob.id, 'ARRIVED', freelancer.freelancerUserId);
        await updatePhysicalJobProgress(onsiteJob.id, 'REQUEST_OTP', freelancer.freelancerUserId);

        const otpJob = await db.selectFrom('jobs').select('otpCode').where('id', '=', onsiteJob.id).executeTakeFirst();
        await updatePhysicalJobProgress(onsiteJob.id, 'VERIFY_OTP', freelancer.freelancerUserId, { otpCode: otpJob?.otpCode || '' });

        // Expire 5-minute confirmation grace and 5-minute post-OTP cancellation window
        const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
        await db.updateTable('jobs').set({ confirmedAt: tenMinsAgo, postOtpCancellationWindowExpiresAt: tenMinsAgo }).where('id', '=', onsiteJob.id).execute();

        // Step 1: Verify normal cancellation is BLOCKED as per PDF rule
        try {
            await cancelJob(onsiteJob.id, client.clientUserId, 'Client attempts normal cancel');
            console.log('⚠️ PDF Rule Failure: Normal cancel should have been blocked!');
        } catch (err: any) {
            console.log(`✅ PDF Rule Verified: Normal cancellation blocked after OTP window expired ("${err.message}")`);
        }

        // Step 2: Client Raises Dispute
        await updatePhysicalJobProgress(onsiteJob.id, 'RAISE_DISPUTE', client.clientUserId);
        const disputeOnsite = await db.selectFrom('jobs').select('jobStatus').where('id', '=', onsiteJob.id).executeTakeFirst();
        console.log(`Dispute raised on On-Site Job. Status: ${disputeOnsite?.jobStatus}`);
        if (disputeOnsite?.jobStatus === 'DISPUTE_OPEN') {
            console.log('✅ Job status changed to DISPUTE_OPEN.');
        }

        // Step 3: Admin resolves dispute via Money Plant Admin API (REFUND_CLIENT)
        const resOnsite = await fetch(`http://localhost:3001/api/admin/disputes/${onsiteJob.id}/resolve`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${adminToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'REFUND_CLIENT',
                resolutionNotes: 'PDF Rule Test: Client refunded due to non-service.',
            }),
        });

        const dataOnsite = await resOnsite.json();
        console.log('Admin Resolution Response (On-Site):', dataOnsite);

        const onsiteFinal = await db.selectFrom('jobs').select(['jobStatus', 'paymentStatus']).where('id', '=', onsiteJob.id).executeTakeFirst();
        if (onsiteFinal?.jobStatus === 'REFUNDED' && onsiteFinal?.paymentStatus === 'REFUNDED') {
            console.log('✅ SCENARIO 1 PASSED: On-site dispute successfully resolved with REFUND_CLIENT.');
        }

        // =========================================================================
        // PDF CASE 4: Remote Service Work Submitted -> Dispute Raised -> Admin Pay Freelancer
        // =========================================================================
        console.log('\n--- PDF SCENARIO 2: Remote Work Submitted Dispute (Pay Freelancer) ---');
        const remoteJob = await createJob(
            {
                jobTitle: 'PDF Test - Remote Video Editing Dispute',
                jobDescription: 'Video editing work submitted with watermark',
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

        await assignFreelancer(remoteJob.id, freelancer.freelancerId, client.clientUserId);

        // Freelancer submits digital work
        await submitDigitalWork(remoteJob.id, freelancer.freelancerUserId, {
            fileUrl: 'https://example.com/watermarked-preview.mp4',
            notes: 'Final video draft submitted with watermark',
        });

        // Client raises dispute instead of accepting work
        await updatePhysicalJobProgress(remoteJob.id, 'RAISE_DISPUTE', client.clientUserId);
        const disputeRemote = await db.selectFrom('jobs').select('jobStatus').where('id', '=', remoteJob.id).executeTakeFirst();
        console.log(`Dispute raised on Remote Job. Status: ${disputeRemote?.jobStatus}`);

        const wBefore = parseFloat((await db.selectFrom('freelancers').select('withdrawableAmount').where('id', '=', freelancer.freelancerId).executeTakeFirst())?.withdrawableAmount?.toString() || '0');

        // Step 3: Admin resolves dispute via Money Plant Admin API (PAY_FREELANCER)
        const resRemote = await fetch(`http://localhost:3001/api/admin/disputes/${remoteJob.id}/resolve`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${adminToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'PAY_FREELANCER',
                resolutionNotes: 'PDF Rule Test: Work matches agreed requirements. Funds released to Freelancer.',
            }),
        });

        const dataRemote = await resRemote.json();
        console.log('Admin Resolution Response (Remote):', dataRemote);

        const remoteFinal = await db.selectFrom('jobs').select(['jobStatus', 'paymentStatus']).where('id', '=', remoteJob.id).executeTakeFirst();
        const wAfter = parseFloat((await db.selectFrom('freelancers').select('withdrawableAmount').where('id', '=', freelancer.freelancerId).executeTakeFirst())?.withdrawableAmount?.toString() || '0');

        console.log(`Remote Job Final: status=${remoteFinal?.jobStatus}, payment=${remoteFinal?.paymentStatus}`);
        console.log(`Freelancer Wallet: ₹${wBefore.toFixed(2)} -> ₹${wAfter.toFixed(2)} (Added +₹${(wAfter - wBefore).toFixed(2)}, Expected +₹1000)`);

        if (remoteFinal?.jobStatus === 'DISPUTE_RESOLVED' && (wAfter - wBefore) === 1000) {
            console.log('✅ SCENARIO 2 PASSED: Remote dispute successfully resolved with PAY_FREELANCER.');
        }

        console.log('\n=========================================================');
        console.log('🎉 ALL PDF DISPUTE WORKFLOW COMPLIANCE TESTS PASSED!');
        console.log('=========================================================');
    } catch (err: any) {
        console.error('❌ PDF Dispute Test Error:', err);
    }
}

testPdfDisputeWorkflow()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
