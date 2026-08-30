import 'dotenv/config';
import { db } from '../lib/db';

async function showAllDisputes() {
    console.log('=========================================================');
    console.log('🔍 FETCHING ALL DISPUTES IN THE SYSTEM');
    console.log('=========================================================');

    const jobs = await db
        .selectFrom('jobs')
        .innerJoin('clients', 'clients.id', 'jobs.clientId')
        .innerJoin('users as clientUser', 'clientUser.id', 'clients.userId')
        .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
        .leftJoin('users as freelancerUser', 'freelancerUser.id', 'freelancers.userId')
        .select([
            'jobs.id',
            'jobs.jobTitle',
            'jobs.jobStatus',
            'jobs.paymentStatus',
            'jobs.paymentMethod',
            'jobs.budgetAmount',
            'jobs.cancellationReason',
            'jobs.createdAt',
            'jobs.updatedAt',
            'clientUser.fullName as clientName',
            'freelancerUser.fullName as freelancerName',
        ])
        .where((eb) =>
            eb.or([
                eb('jobs.jobStatus', '=', 'DISPUTE_OPEN' as any),
                eb('jobs.jobStatus', '=', 'DISPUTE_RESOLVED' as any),
                eb('jobs.jobStatus', '=', 'REFUNDED' as any),
                eb('jobs.cancellationReason', 'like', '%Dispute%'),
            ])
        )
        .orderBy('jobs.updatedAt', 'desc')
        .execute();

    console.log(`Found ${jobs.length} dispute records:\n`);

    jobs.forEach((j, index) => {
        console.log(`--- [Dispute #${index + 1}] ---`);
        console.log(`Job ID: ${j.id}`);
        console.log(`Title: "${j.jobTitle}"`);
        console.log(`Client: ${j.clientName || 'N/A'}`);
        console.log(`Freelancer: ${j.freelancerName || 'N/A'}`);
        console.log(`Payment Method: ${j.paymentMethod || 'CASH'}`);
        console.log(`Budget: ₹${j.budgetAmount}`);
        console.log(`Current DB Job Status: ${j.jobStatus}`);
        console.log(`Current DB Payment Status: ${j.paymentStatus}`);
        console.log(`Reason / Resolution Notes: ${j.cancellationReason || 'None'}`);
        console.log(`Last Updated: ${j.updatedAt}\n`);
    });
}

showAllDisputes()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
