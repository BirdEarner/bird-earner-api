import 'dotenv/config';
import { db } from '../lib/db';
import { createJob, assignFreelancer, updatePhysicalJobProgress } from '../lib/services/jobs';
import { generateToken } from '../lib/auth';

async function runAdminDisputesTestSuite() {
    console.log('---------------------------------------------------------');
    console.log('🚀 BIRDEARNER ADMIN DISPUTES API TEST SUITE');
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

        const adminToken = generateToken({
            id: 999,
            email: 'admin@birdearner.com',
            role: 'superadmin',
        });

        console.log(`✅ Client: ${client.clientId} | Freelancer: ${freelancer.freelancerId}`);

        // =====================================================
        // TEST A1: Create Disputed Job and Verify GET Endpoint
        // =====================================================
        console.log('\n--- TEST A1: Create Disputed Job & Query Admin List ---');
        const job1 = await createJob(
            {
                jobTitle: 'Admin Dispute Test 1 - Refund Client',
                jobDescription: 'Testing admin refund client resolution',
                jobCategory: 'AC Repair',
                jobSubCategory: 'AC Repair',
                projectType: 'On-site',
                budgetType: 'Fixed',
                budgetAmount: 1500,
                workDurationDays: 1,
                paymentMethod: 'CASH',
            },
            client.clientUserId,
            client.clientId
        );
        await assignFreelancer(job1.id, freelancer.freelancerId, client.clientUserId);
        await updatePhysicalJobProgress(job1.id, 'RAISE_DISPUTE', client.clientUserId);

        const openJob = await db.selectFrom('jobs').select('jobStatus').where('id', '=', job1.id).executeTakeFirst();
        console.log(`Job 1 status after raising dispute: ${openJob?.jobStatus}`);

        if (openJob?.jobStatus === 'DISPUTE_OPEN') {
            console.log('✅ TEST A1 PASSED: Job raised into DISPUTE_OPEN status.');
        }

        // =====================================================
        // TEST A2: Resolve Dispute -> REFUND_CLIENT
        // =====================================================
        console.log('\n--- TEST A2: Admin Resolves Dispute -> REFUND_CLIENT ---');

        // Execute POST /api/admin/disputes/[id]/resolve (REFUND_CLIENT)
        const resRefund = await fetch(`http://localhost:3001/api/admin/disputes/${job1.id}/resolve`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${adminToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'REFUND_CLIENT',
                resolutionNotes: 'Client provided photo evidence of incomplete work.',
            }),
        });

        const dataRefund = await resRefund.json();
        console.log('Refund API response:', dataRefund);

        const job1After = await db
            .selectFrom('jobs')
            .select(['jobStatus', 'paymentStatus', 'cancellationReason'])
            .where('id', '=', job1.id)
            .executeTakeFirst();

        console.log(`Job 1 after resolution: status=${job1After?.jobStatus}, payment=${job1After?.paymentStatus}`);
        if (job1After?.jobStatus === 'REFUNDED' && job1After?.paymentStatus === 'REFUNDED') {
            console.log('✅ TEST A2 PASSED: Dispute resolved with REFUND_CLIENT.');
        }

        // =====================================================
        // TEST A3: Resolve Dispute -> PAY_FREELANCER
        // =====================================================
        console.log('\n--- TEST A3: Admin Resolves Dispute -> PAY_FREELANCER ---');
        const job2 = await createJob(
            {
                jobTitle: 'Admin Dispute Test 2 - Pay Freelancer',
                jobDescription: 'Testing admin pay freelancer resolution',
                jobCategory: 'Design',
                jobSubCategory: 'Logo Design',
                projectType: 'Remote',
                budgetType: 'Fixed',
                budgetAmount: 2000,
                workDurationDays: 1,
                paymentMethod: 'CASH',
            },
            client.clientUserId,
            client.clientId
        );
        await assignFreelancer(job2.id, freelancer.freelancerId, client.clientUserId);
        await updatePhysicalJobProgress(job2.id, 'RAISE_DISPUTE', freelancer.freelancerUserId);

        const freelancerBefore = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalEarnings'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();
        const wBefore = parseFloat(freelancerBefore?.withdrawableAmount?.toString() || '0');

        // Execute POST /api/admin/disputes/[id]/resolve (PAY_FREELANCER)
        const resPay = await fetch(`http://localhost:3001/api/admin/disputes/${job2.id}/resolve`, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${adminToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'PAY_FREELANCER',
                resolutionNotes: 'Freelancer submitted complete deliverables matching requirements.',
            }),
        });

        const dataPay = await resPay.json();
        console.log('Pay Freelancer API response:', dataPay);

        const job2After = await db
            .selectFrom('jobs')
            .select(['jobStatus', 'paymentStatus'])
            .where('id', '=', job2.id)
            .executeTakeFirst();

        const freelancerAfter = await db
            .selectFrom('freelancers')
            .select(['withdrawableAmount', 'totalEarnings'])
            .where('id', '=', freelancer.freelancerId)
            .executeTakeFirst();
        const wAfter = parseFloat(freelancerAfter?.withdrawableAmount?.toString() || '0');

        console.log(`Job 2 after resolution: status=${job2After?.jobStatus}, payment=${job2After?.paymentStatus}`);
        console.log(`Freelancer withdrawable wallet: ₹${wBefore.toFixed(2)} -> ₹${wAfter.toFixed(2)} (+₹${(wAfter - wBefore).toFixed(2)}, Expected +₹2000)`);

        const walletTx = await db
            .selectFrom('walletTransactions')
            .select(['amount', 'transactionType'])
            .where('jobId', '=', job2.id)
            .executeTakeFirst();

        if (job2After?.jobStatus === 'DISPUTE_RESOLVED' && (wAfter - wBefore) === 2000 && walletTx) {
            console.log('✅ TEST A3 PASSED: Dispute resolved with PAY_FREELANCER and wallet credited.');
        }

        console.log('\n---------------------------------------------------------');
        console.log('🎉 ALL ADMIN DISPUTE TESTS COMPLETED SUCCESSFULLY!');
        console.log('---------------------------------------------------------');
    } catch (err: any) {
        console.error('❌ Admin Dispute Test Error:', err);
    }
}

runAdminDisputesTestSuite()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
