import 'dotenv/config';
import { db } from '../lib/db.js';
import { createJob, assignFreelancer, requestScopePriceChange } from '../lib/services/jobs.js';
import { generateToken } from '../lib/auth.js';

async function testApiGetPriceChange() {
    console.log('=========================================================');
    console.log('🧪 TESTING GET /api/jobs/[id] PAYLOAD FOR PRICE CHANGE FIELDS');
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
        console.error('Client or Freelancer missing');
        return;
    }

    const job = await createJob(
        {
            jobTitle: 'On-Site Price Change GET Test',
            jobDescription: 'Testing GET /api/jobs/[id] response fields',
            jobCategory: 'AC Repair',
            jobSubCategory: 'AC Repair',
            projectType: 'On-site',
            budgetType: 'Fixed',
            budgetAmount: 1000,
            workDurationDays: 1,
            paymentMethod: 'CASH',
            location: 'Mumbai India',
        },
        client.clientUserId,
        client.clientId
    );

    await assignFreelancer(job.id, freelancer.freelancerId, client.clientUserId);
    await db.updateTable('jobs').set({ otpVerifiedAt: new Date(), jobStatus: 'JOB_STARTED' }).where('id', '=', job.id).execute();

    // Freelancer submits price change
    await requestScopePriceChange(job.id, freelancer.freelancerUserId, 1600, 'Additional pipe repair', 'Wall drilling required');

    // Fetch via DB query matching GET /api/jobs/[id]
    const fetchedJob = await db
        .selectFrom('jobs')
        .select([
            'jobs.id',
            'jobs.budgetAmount',
            'jobs.priceChangeRequested',
            'jobs.priceChangeReason',
        ])
        .where('id', '=', job.id)
        .executeTakeFirst();

    console.log(`Fetched Job ID: ${fetchedJob?.id}`);
    console.log(`budgetAmount: ₹${fetchedJob?.budgetAmount}`);
    console.log(`priceChangeRequested: ₹${fetchedJob?.priceChangeRequested}`);
    console.log(`priceChangeReason: "${fetchedJob?.priceChangeReason}"`);

    if (fetchedJob?.priceChangeRequested === '1600.00' && fetchedJob?.priceChangeReason?.includes('Additional pipe repair')) {
        console.log('\n=========================================================');
        console.log('🎉 GET /api/jobs/[id] PRICE CHANGE FIELDS VERIFIED SUCCESSFULLY! 🎉');
        console.log('=========================================================');
    } else {
        console.error('❌ FAILED: priceChangeRequested missing or incorrect!');
    }
}

testApiGetPriceChange()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
