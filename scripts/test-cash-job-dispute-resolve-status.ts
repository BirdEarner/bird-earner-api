import 'dotenv/config';
import { db } from '../lib/db';
import { createJob, assignFreelancer } from '../lib/services/jobs';
import { generateToken } from '../lib/auth';

async function testCashJobDisputeResolveStatus() {
    console.log('=========================================================');
    console.log('🧪 TESTING DISPUTE RESOLVE (REFUND_CLIENT) FOR CASH JOB');
    console.log('=========================================================');

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
        console.error('Client or Freelancer not found');
        return;
    }

    const job = await createJob(
        {
            jobTitle: 'Cash Job Dispute Status Test',
            jobDescription: 'Testing dispute resolution status text',
            jobCategory: 'General',
            jobSubCategory: 'General',
            projectType: 'On-site',
            budgetType: 'Fixed',
            budgetAmount: 1500,
            workDurationDays: 1,
            paymentMethod: 'CASH',
        },
        client.clientUserId,
        client.clientId
    );

    await assignFreelancer(job.id, freelancer.freelancerId, client.clientUserId);

    await db.updateTable('jobs').set({ jobStatus: 'DISPUTE_OPEN' as any }).where('id', '=', job.id).execute();

    const adminToken = generateToken({ id: 'admin-1', email: 'admin@birdearner.com', role: 'admin' });

    console.log('Resolving dispute with REFUND_CLIENT for cash job...');
    const res = await fetch(`http://localhost:3001/api/admin/disputes/${job.id}/resolve`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${adminToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            action: 'REFUND_CLIENT',
            resolutionNotes: 'Client did not receive service. Dispute resolved in favor of client. No cash payment required.',
        }),
    });

    console.log('HTTP Status:', res.status);
    const data = await res.json();

    const updatedJob = await db.selectFrom('jobs').select(['jobStatus', 'paymentStatus', 'cancellationReason']).where('id', '=', job.id).executeTakeFirst();

    console.log('\n--- VERIFICATION RESULTS ---');
    console.log('Updated jobStatus:', updatedJob?.jobStatus);
    console.log('Updated paymentStatus:', updatedJob?.paymentStatus);
    console.log('Cancellation Reason:', updatedJob?.cancellationReason);

    if (updatedJob?.jobStatus === 'CANCELLED' && updatedJob?.paymentStatus === 'CANCELLED') {
        console.log('=========================================================');
        console.log('✅ TEST PASSED: Cash job status correctly set to CANCELLED instead of REFUNDED!');
        console.log('=========================================================');
    } else {
        console.error('❌ TEST FAILED: jobStatus is still set to REFUNDED');
    }
}

testCashJobDisputeResolveStatus()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
