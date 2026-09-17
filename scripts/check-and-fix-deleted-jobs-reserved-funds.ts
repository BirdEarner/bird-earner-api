import 'dotenv/config';
import { db } from '../lib/db';
import { releaseReservedAmountInTransaction } from '../lib/services/wallet';

async function checkAndFixDeletedJobs() {
    console.log('=========================================================');
    console.log('🔍 CHECKING FOR DELETED JOBS WITH ORPHANED RESERVED FUNDS');
    console.log('=========================================================');

    const orphanedJobs = await db
        .selectFrom('jobs')
        .innerJoin('clients', 'clients.id', 'jobs.clientId')
        .select([
            'jobs.id',
            'jobs.jobTitle',
            'jobs.budgetAmount',
            'jobs.isAmountReserved',
            'jobs.paymentMethod',
            'clients.userId as clientUserId',
            'clients.id as clientId',
        ])
        .where('jobs.deleted', '=', true)
        .where('jobs.isAmountReserved', '=', true)
        .execute();

    console.log(`Found ${orphanedJobs.length} deleted job(s) with unreleased reserved funds.`);

    for (const job of orphanedJobs) {
        console.log(`\nReleasing reserved funds for deleted job "${job.jobTitle}" (ID: ${job.id}, Amount: ₹${job.budgetAmount})...`);
        await db.transaction().execute(async (trx) => {
            await releaseReservedAmountInTransaction(trx, job.clientUserId, job.id);
            await trx
                .updateTable('jobs')
                .set({ isAmountReserved: false, updatedAt: new Date() })
                .where('id', '=', job.id)
                .execute();
        });
        console.log(`✅ Successfully released ₹${job.budgetAmount} back to client wallet available balance!`);
    }

    console.log('\n=========================================================');
    console.log('🎉 ORPHANED RESERVED FUNDS CHECK COMPLETE!');
    console.log('=========================================================');
    process.exit(0);
}

checkAndFixDeletedJobs().catch((err) => {
    console.error('❌ Check error:', err);
    process.exit(1);
});
