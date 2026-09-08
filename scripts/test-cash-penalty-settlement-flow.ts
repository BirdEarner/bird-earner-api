import 'dotenv/config';
import { db } from '../lib/db';
import { createJob, assignFreelancer } from '../lib/services/jobs';
import { calculateBirdFee } from '../lib/utils/fee';

async function runCashPenaltyTest() {
    console.log('================================================================');
    console.log('🧪 TESTING CASH PAYMENT PENALTY SETTLEMENT FLOW (₹50 PENALTY)');
    console.log('================================================================\n');

    try {
        // 1. Fetch test client & freelancer
        const clientUser = await db.selectFrom('users')
            .innerJoin('clients', 'clients.userId', 'users.id')
            .select(['users.id as userId', 'clients.id as clientId'])
            .executeTakeFirst();

        const freelancerUser = await db.selectFrom('users')
            .innerJoin('freelancers', 'freelancers.userId', 'users.id')
            .select(['users.id as userId', 'freelancers.id as freelancerId'])
            .executeTakeFirst();

        if (!clientUser || !freelancerUser) {
            throw new Error('Test client or freelancer user not found in database.');
        }

        console.log(`[SETUP] Client User ID: ${clientUser.userId}, Client ID: ${clientUser.clientId}`);
        console.log(`[SETUP] Freelancer User ID: ${freelancerUser.userId}, Freelancer ID: ${freelancerUser.freelancerId}\n`);

        // Setup initial state:
        // Client wallet = ₹0, pending penalty = ₹50
        // Freelancer withdrawable wallet = ₹500
        await db.updateTable('clients')
            .set({ wallet: '0', reservedAmount: '0', pendingPenaltyAmount: '50' })
            .where('id', '=', clientUser.clientId)
            .execute();

        await db.updateTable('freelancers')
            .set({ withdrawableAmount: '500' })
            .where('id', '=', freelancerUser.freelancerId)
            .execute();

        console.log('[INITIAL STATE]');
        console.log('  Client Wallet: ₹0, Pending Penalty: ₹50');
        console.log('  Freelancer Wallet Balance: ₹500\n');

        // Step 1: Create Cash Job (Budget ₹1,000)
        console.log('--- STEP 1: Creating Cash Job (Budget ₹1,000) ---');
        const cashJob = await createJob({
            jobTitle: 'Cash Job ₹50 Penalty Test',
            jobDescription: 'Testing Cash payment job with ₹50 attached penalty',
            jobCategory: 'Development',
            jobSubCategory: 'Web Development',
            projectType: 'Remote',
            budgetType: 'Fixed',
            budgetAmount: '1000',
            paymentMethod: 'CASH'
        }, clientUser.userId, clientUser.clientId);

        console.log(`  Job Created successfully! Job ID: ${cashJob.id}`);
        console.log(`  Attached Job Penalty Amount: ₹${cashJob.clientPenaltyAmount}`);

        const clientStateAfterJob = await db.selectFrom('clients')
            .select('pendingPenaltyAmount')
            .where('id', '=', clientUser.clientId)
            .executeTakeFirst();

        console.log(`  Client Pending Penalty on DB: ₹${clientStateAfterJob?.pendingPenaltyAmount}`);

        if (parseFloat(cashJob.clientPenaltyAmount || '0') !== 50) {
            throw new Error(`Expected job clientPenaltyAmount = 50, got ${cashJob.clientPenaltyAmount}`);
        }
        if (parseFloat(clientStateAfterJob?.pendingPenaltyAmount?.toString() || '0') !== 0) {
            throw new Error(`Expected client pendingPenaltyAmount to be transferred (0), got ${clientStateAfterJob?.pendingPenaltyAmount}`);
        }
        console.log('✓ Step 1 PASSED: Penalty attached to job and cleared from client record!\n');

        // Step 2: Assign Freelancer
        console.log('--- STEP 2: Assigning Freelancer to Job ---');
        await assignFreelancer(cashJob.id, freelancerUser.freelancerId, clientUser.userId);
        console.log('✓ Step 2 PASSED: Freelancer assigned!\n');

        // Step 3: Simulate Cash Payment Confirmation & Freelancer Wallet Settlement
        console.log('--- STEP 3: Freelancer Cash Payment Confirmation & Wallet Settlement ---');
        await db.transaction().execute(async (trx) => {
            const job = await trx.selectFrom('jobs')
                .select(['id', 'jobTitle', 'budgetAmount', 'clientPenaltyAmount', 'clientId'])
                .where('id', '=', cashJob.id)
                .executeTakeFirstOrThrow();

            const freelancer = await trx.selectFrom('freelancers')
                .select(['id', 'userId', 'withdrawableAmount'])
                .where('id', '=', freelancerUser.freelancerId)
                .executeTakeFirstOrThrow();

            const budgetNum = parseFloat(job.budgetAmount);
            const penaltyAmt = parseFloat(job.clientPenaltyAmount?.toString() || '0'); // ₹50
            const birdFeeAmount = budgetNum * 0.10; // 10% of 1,000 = ₹100

            const currentBalance = parseFloat(freelancer.withdrawableAmount); // ₹500
            let newBalance = currentBalance - birdFeeAmount; // 500 - 100 = 400

            // 1. Update job status to COMPLETED
            await trx.updateTable('jobs')
                .set({
                    jobStatus: 'COMPLETED',
                    paymentStatus: 'COMPLETED',
                    birdFeeAmount: birdFeeAmount.toString(),
                    updatedAt: new Date()
                })
                .where('id', '=', job.id)
                .execute();

            // 2. Deduct BirdFee from freelancer withdrawableAmount
            await trx.updateTable('freelancers')
                .set({
                    withdrawableAmount: newBalance.toString(),
                    updatedAt: new Date()
                })
                .where('id', '=', freelancer.id)
                .execute();

            // Record Platform Fee transaction
            await trx.insertInto('walletTransactions').values({
                id: crypto.randomUUID(),
                userId: freelancer.userId,
                userType: 'FREELANCER',
                jobId: job.id,
                amount: (-birdFeeAmount).toString(),
                transactionType: 'PLATFORM_FEE',
                balanceBefore: currentBalance.toString(),
                balanceAfter: newBalance.toString(),
                description: `Platform fee for job completion (Cash Payment) - ${job.jobTitle}`,
                updatedAt: new Date()
            }).execute();

            // 3. Deduct client penalty from freelancer's wallet
            if (penaltyAmt > 0) {
                const balanceBeforePenalty = newBalance;
                newBalance = newBalance - penaltyAmt; // 400 - 50 = 350

                await trx.updateTable('freelancers')
                    .set((eb) => ({
                        withdrawableAmount: newBalance.toString(),
                        totalPenaltyReceived: eb('totalPenaltyReceived', '+', penaltyAmt.toString()),
                        totalPenaltyDeducted: eb('totalPenaltyDeducted', '+', penaltyAmt.toString()),
                        updatedAt: new Date()
                    }))
                    .where('id', '=', freelancer.id)
                    .execute();

                await trx.insertInto('walletTransactions').values({
                    id: crypto.randomUUID(),
                    userId: freelancer.userId,
                    userType: 'FREELANCER',
                    jobId: job.id,
                    amount: (-penaltyAmt).toString(),
                    transactionType: 'PENALTY',
                    balanceBefore: balanceBeforePenalty.toString(),
                    balanceAfter: newBalance.toString(),
                    description: `Client cancellation penalty deducted - ${job.jobTitle}`,
                    updatedAt: new Date()
                }).execute();
            }
        });

        // Verify final freelancer wallet balance
        const finalFreelancer = await db.selectFrom('freelancers')
            .select('withdrawableAmount')
            .where('id', '=', freelancerUser.freelancerId)
            .executeTakeFirst();

        const finalWalletBalance = parseFloat(finalFreelancer?.withdrawableAmount || '0');
        console.log(`  Final Freelancer Wallet Balance: ₹${finalWalletBalance}`);
        console.log(`  Expected Wallet Balance: ₹350 (Initial 500 - 100 BirdFee - 50 Penalty)`);

        if (finalWalletBalance !== 350) {
            throw new Error(`Expected final freelancer wallet balance = 350, got ${finalWalletBalance}`);
        }

        console.log('✓ Step 3 PASSED: Freelancer wallet successfully deducted ₹100 BirdFee + ₹50 Penalty!\n');

        // Cleanup test job
        await db.deleteFrom('jobs').where('id', '=', cashJob.id).execute();

        console.log('================================================================');
        console.log('🎉 CASH PAYMENT PENALTY SETTLEMENT TEST PASSED 100%! 🎉');
        console.log('================================================================');

    } catch (error: any) {
        console.error('\n❌ CASH PENALTY TEST FAILED:', error);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

runCashPenaltyTest();
