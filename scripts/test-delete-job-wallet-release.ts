import 'dotenv/config';
import { db } from '../lib/db';
import { createJob } from '../lib/services/jobs';
import { getClientWallet, releaseReservedAmountInTransaction } from '../lib/services/wallet';

async function testDeleteJobWalletRelease() {
    console.log('=========================================================');
    console.log('🧪 TESTING JOB DELETION WALLET RELEASE FLOW');
    console.log('=========================================================');

    const clientUser = await db
        .selectFrom('users')
        .innerJoin('clients', 'clients.userId', 'users.id')
        .select(['users.id as userId', 'clients.id as clientId'])
        .executeTakeFirst();

    if (!clientUser) {
        console.error('Test client user not found');
        process.exit(1);
    }

    // Set client wallet to 5000
    await db
        .updateTable('clients')
        .set({ wallet: '5000.00', reservedAmount: '0.00', availableBalance: '5000.00', pendingPenaltyAmount: '0.00' })
        .where('id', '=', clientUser.clientId)
        .execute();

    const initialWallet = await getClientWallet(clientUser.userId);
    console.log(`Initial wallet: total=${initialWallet.totalBalance}, reserved=${initialWallet.reservedAmount}, available=${initialWallet.availableBalance}`);

    console.log('\n--- STEP 1: Client creates OPEN platform job (₹1500) ---');
    const job = await createJob(
        {
            jobTitle: 'Test Job Deletion Wallet Refund',
            jobDescription: 'Testing reserved amount release on deletion',
            jobCategory: 'General',
            jobSubCategory: 'General',
            budgetType: 'fixed',
            budgetAmount: '1500.00',
            projectType: 'on-site',
            paymentMethod: 'PLATFORM',
            workDurationDays: 1,
        },
        clientUser.userId,
        clientUser.clientId
    );

    console.log(`✅ Job created successfully: ID=${job.id}, reserved=${job.isAmountReserved}`);

    const walletAfterCreation = await getClientWallet(clientUser.userId);
    console.log(`✅ Wallet after creation: reserved=${walletAfterCreation.reservedAmount} (expected 1500), available=${walletAfterCreation.availableBalance} (expected 3500)`);

    if (walletAfterCreation.reservedAmount !== 1500 || walletAfterCreation.availableBalance !== 3500) {
        throw new Error(`Creation wallet mismatch: reserved=${walletAfterCreation.reservedAmount}, available=${walletAfterCreation.availableBalance}`);
    }

    console.log('\n--- STEP 2: Client deletes the OPEN job ---');
    await db.transaction().execute(async (trx) => {
        const jobToDel = await trx
            .selectFrom('jobs')
            .select(['isAmountReserved', 'budgetAmount'])
            .where('id', '=', job.id)
            .executeTakeFirst();

        if (jobToDel?.isAmountReserved) {
            await releaseReservedAmountInTransaction(trx, clientUser.userId, job.id);
        }

        await trx
            .updateTable('jobs')
            .set({
                deleted: true,
                isAmountReserved: false,
                paymentStatus: 'CANCELLED',
                jobStatus: 'CANCELLED_BY_CLIENT',
                updatedAt: new Date(),
            })
            .where('id', '=', job.id)
            .execute();
    });

    const walletAfterDeletion = await getClientWallet(clientUser.userId);
    console.log(`✅ Wallet after deletion: reserved=${walletAfterDeletion.reservedAmount} (expected 0), available=${walletAfterDeletion.availableBalance} (expected 5000)`);

    if (walletAfterDeletion.reservedAmount !== 0 || walletAfterDeletion.availableBalance !== 5000) {
        throw new Error(`Deletion wallet refund failure: reserved=${walletAfterDeletion.reservedAmount}, available=${walletAfterDeletion.availableBalance}`);
    }

    const jobAfterDel = await db.selectFrom('jobs').select(['deleted', 'isAmountReserved', 'paymentStatus']).where('id', '=', job.id).executeTakeFirst();
    console.log(`✅ Job state in DB: deleted=${jobAfterDel?.deleted}, isAmountReserved=${jobAfterDel?.isAmountReserved}, paymentStatus=${jobAfterDel?.paymentStatus}`);

    console.log('\n=========================================================');
    console.log('🎉 JOB DELETION WALLET RELEASE TEST PASSED SUCCESSFULLY!');
    console.log('=========================================================');
    process.exit(0);
}

testDeleteJobWalletRelease().catch((err) => {
    console.error('❌ Test error:', err);
    process.exit(1);
});
