import 'dotenv/config';
import { db } from '../lib/db';
import { createJob, assignFreelancer } from '../lib/services/jobs';
import { generateToken } from '../lib/auth';

async function testRaiseDisputeWithReason() {
    console.log('=========================================================');
    console.log('🧪 TESTING RAISE DISPUTE WITH CUSTOM USER REASON');
    console.log('=========================================================');

    const client = await db
        .selectFrom('clients')
        .innerJoin('users', 'users.id', 'clients.userId')
        .select(['clients.id as clientId', 'users.id as clientUserId', 'users.email as clientEmail'])
        .executeTakeFirst();

    const freelancer = await db
        .selectFrom('freelancers')
        .innerJoin('users', 'users.id', 'freelancers.userId')
        .select(['freelancers.id as freelancerId', 'users.id as freelancerUserId', 'users.email as freelancerEmail'])
        .executeTakeFirst();

    if (!client || !freelancer) {
        console.error('Test client or freelancer missing');
        return;
    }

    const job = await createJob(
        {
            jobTitle: 'Dispute Reason Test Job',
            jobDescription: 'Testing custom reason capture upon raising dispute',
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

    const clientToken = generateToken({
        id: client.clientUserId,
        email: client.clientEmail,
        role: 'user',
    });

    const customReason = 'Client refusing cash payment after freelancer arrived at site';

    console.log(`Sending RAISE_DISPUTE request with reason: "${customReason}"...`);

    const res = await fetch(`http://localhost:3001/api/jobs/${job.id}/progress`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${clientToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            action: 'RAISE_DISPUTE',
            reason: customReason,
        }),
    });

    console.log('HTTP Status:', res.status);
    const data = await res.json();
    console.log('Response:', data);

    const jobAfter = await db.selectFrom('jobs').select(['jobStatus', 'cancellationReason']).where('id', '=', job.id).executeTakeFirst();
    const history = await db.selectFrom('jobStatusHistory').select(['status', 'action', 'reason']).where('jobId', '=', job.id).where('action', '=', 'RAISE_DISPUTE').executeTakeFirst();

    console.log(`Job Status: ${jobAfter?.jobStatus}`);
    console.log(`Cancellation Reason in DB: "${jobAfter?.cancellationReason}"`);
    console.log(`Status History Reason in DB: "${history?.reason}"`);

    if (
        jobAfter?.jobStatus === 'DISPUTE_OPEN' &&
        jobAfter?.cancellationReason?.includes(customReason) &&
        history?.reason === customReason
    ) {
        console.log('=========================================================');
        console.log('✅ TEST PASSED: Custom dispute reason captured & stored successfully!');
        console.log('=========================================================');
    } else {
        console.error('❌ TEST FAILED: Reason mismatch or status error');
    }
}

testRaiseDisputeWithReason()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
