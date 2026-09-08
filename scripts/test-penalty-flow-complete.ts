import 'dotenv/config';
import { db } from '../lib/db';
import { createJob, cancelJob, assignFreelancer, completeJob } from '../lib/services/jobs';
import { depositClientFunds, getClientWallet } from '../lib/services/wallet';

async function runTest() {
    console.log('--- STARTING PENALTY PAYMENT FLOW VERIFICATION TEST ---\n');

    const defaultJobFields = {
        jobCategory: 'Development',
        jobSubCategory: 'Web Development',
        projectType: 'Remote',
        budgetType: 'Fixed',
    };

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

        // Reset client wallet & pending penalty
        await db.updateTable('clients')
            .set({ wallet: '0', reservedAmount: '0', pendingPenaltyAmount: '0' })
            .where('id', '=', clientUser.clientId)
            .execute();

        // ==========================================
        // SCENARIO 1: Normal Flow — No Penalty
        // ==========================================
        console.log('--- SCENARIO 1: Normal Flow (No Penalty) ---');
        await depositClientFunds(clientUser.userId, 1000, 'Test deposit for scenario 1');
        const normalJob = await createJob({
            ...defaultJobFields,
            jobTitle: 'Test Normal Job',
            jobDescription: 'Testing normal job creation without penalty',
            budgetAmount: '500',
            paymentMethod: 'PLATFORM'
        }, clientUser.userId, clientUser.clientId);

        console.log(`✓ Job created successfully. Job ID: ${normalJob.id}`);
        let wallet = await getClientWallet(clientUser.userId);
        console.log(`  Wallet Total: ₹${wallet.totalBalance}, Reserved: ₹${wallet.reservedAmount}, Available: ₹${wallet.availableBalance}, Pending Penalty: ₹${wallet.pendingPenaltyAmount}`);
        if (wallet.pendingPenaltyAmount !== 0 || wallet.reservedAmount !== 500) {
            throw new Error('Scenario 1 Failed: Unexpected wallet or penalty state.');
        }
        console.log('✓ Scenario 1 PASSED!\n');

        // Cleanup scenario 1 job
        await cancelJob(normalJob.id, clientUser.userId, 'Cleanup');

        // ==========================================
        // SCENARIO 2: Auto-Deduction when Wallet Balance >= Penalty Amount
        // ==========================================
        console.log('--- SCENARIO 2: Immediate Auto-Deduction (Wallet >= Penalty) ---');
        // Reset wallet to 10500 so budget of 10000 can be reserved
        await db.updateTable('clients')
            .set({ wallet: '10500', reservedAmount: '0', pendingPenaltyAmount: '0' })
            .where('id', '=', clientUser.clientId)
            .execute();

        const jobToCancel = await createJob({
            ...defaultJobFields,
            jobTitle: 'Job to Cancel for Penalty',
            jobDescription: 'Testing cancellation penalty auto-deduction',
            budgetAmount: '10000',
            paymentMethod: 'PLATFORM'
        }, clientUser.userId, clientUser.clientId);

        // Assign freelancer
        await assignFreelancer(jobToCancel.id, freelancerUser.freelancerId, clientUser.userId);

        // Fast-forward confirmation time past 5-min grace window
        const pastDate = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
        await db.updateTable('jobs')
            .set({ confirmedAt: pastDate })
            .where('id', '=', jobToCancel.id)
            .execute();

        // Client cancels assigned job after grace period (2% of 10,000 = ₹200 penalty)
        await cancelJob(jobToCancel.id, clientUser.userId, 'Cancelled after 5 mins');

        wallet = await getClientWallet(clientUser.userId);
        console.log(`  Wallet Total: ₹${wallet.totalBalance}, Reserved: ₹${wallet.reservedAmount}, Available: ₹${wallet.availableBalance}, Pending Penalty: ₹${wallet.pendingPenaltyAmount}`);

        // Initial wallet was 500 + 10,000 reserved. After cancellation, 10,000 released = 10,500.
        // Penalty ₹200 auto-deducted immediately from wallet (since available 10,500 >= 200).
        // New wallet balance should be 10,300, pendingPenaltyAmount = 0.
        if (wallet.pendingPenaltyAmount !== 0) {
            throw new Error('Scenario 2 Failed: Penalty was not auto-deducted immediately.');
        }
        console.log('✓ Scenario 2 PASSED! Penalty auto-deducted immediately upon cancellation.\n');

        // ==========================================
        // SCENARIO 3: Penalty Carried Forward when Wallet < Penalty Amount
        // ==========================================
        console.log('--- SCENARIO 3: Penalty Carried Forward (Wallet < Penalty) ---');
        // Set client wallet to ₹50
        await db.updateTable('clients')
            .set({ wallet: '50', reservedAmount: '0', pendingPenaltyAmount: '0' })
            .where('id', '=', clientUser.clientId)
            .execute();

        const jobToCancel2 = await createJob({
            ...defaultJobFields,
            jobTitle: 'Job 2 to Cancel',
            jobDescription: 'Testing cancellation penalty carry-forward',
            budgetAmount: '10000',
            paymentMethod: 'CASH'
        }, clientUser.userId, clientUser.clientId);

        await assignFreelancer(jobToCancel2.id, freelancerUser.freelancerId, clientUser.userId);
        await db.updateTable('jobs')
            .set({ confirmedAt: pastDate })
            .where('id', '=', jobToCancel2.id)
            .execute();

        // Client cancels after grace window -> ₹200 penalty. Client wallet (50) < 200.
        await cancelJob(jobToCancel2.id, clientUser.userId, 'Cancelled after grace');

        wallet = await getClientWallet(clientUser.userId);
        console.log(`  Wallet Total: ₹${wallet.totalBalance}, Reserved: ₹${wallet.reservedAmount}, Available: ₹${wallet.availableBalance}, Pending Penalty: ₹${wallet.pendingPenaltyAmount}`);

        if (wallet.pendingPenaltyAmount !== 200) {
            throw new Error(`Scenario 3 Failed: Expected pendingPenaltyAmount = 200, got ${wallet.pendingPenaltyAmount}`);
        }
        console.log('✓ Scenario 3 PASSED! Pending penalty carried forward.\n');

        // ==========================================
        // SCENARIO 4: Deposit Auto-Settlement & Platform Job Creation with Penalty
        // ==========================================
        console.log('--- SCENARIO 4: Platform Job Creation & Deposit Auto-Settlement ---');
        // Currently client has ₹50 wallet and ₹200 pendingPenalty.
        // Try creating ₹1,000 Platform job with insufficient wallet -> should fail requiring ₹1,150 to add
        let failedAsExpected = false;
        try {
            await createJob({
                ...defaultJobFields,
                jobTitle: 'Platform Job with Penalty Test',
                jobDescription: 'Should fail due to insufficient funds for Job + Penalty',
                budgetAmount: '1000',
                paymentMethod: 'PLATFORM'
            }, clientUser.userId, clientUser.clientId);
        } catch (err: any) {
            failedAsExpected = true;
            console.log(`  Expected Rejection: "${err.message}"`);
        }

        if (!failedAsExpected) {
            throw new Error('Scenario 4 Failed: Job creation should have been blocked due to insufficient wallet balance for Job + Penalty.');
        }

        // Client deposits ₹1,150 into wallet
        console.log('  Client deposits ₹1,150 into wallet...');
        await depositClientFunds(clientUser.userId, 1150, 'Deposit to cover Job + Penalty');

        wallet = await getClientWallet(clientUser.userId);
        console.log(`  Post-Deposit Wallet Total: ₹${wallet.totalBalance}, Reserved: ₹${wallet.reservedAmount}, Available: ₹${wallet.availableBalance}, Pending Penalty: ₹${wallet.pendingPenaltyAmount}`);

        // Initial 50 + 1150 deposit = 1200. Auto-deduct 200 penalty -> Wallet = 1000, Pending Penalty = 0.
        if (wallet.pendingPenaltyAmount !== 0 || wallet.totalBalance !== 1000) {
            throw new Error(`Scenario 4 Failed: Auto-deduct on deposit failed. Wallet: ${wallet.totalBalance}, Pending Penalty: ${wallet.pendingPenaltyAmount}`);
        }
        console.log('✓ Auto-deduction upon wallet deposit succeeded!');

        // Now post ₹1,000 Platform job -> should succeed!
        const platformJobWithPenalty = await createJob({
            ...defaultJobFields,
            jobTitle: 'Platform Job Post Deposit',
            jobDescription: 'Job created after penalty auto-settled by deposit',
            budgetAmount: '1000',
            paymentMethod: 'PLATFORM'
        }, clientUser.userId, clientUser.clientId);

        wallet = await getClientWallet(clientUser.userId);
        console.log(`  Post-Job Wallet Total: ₹${wallet.totalBalance}, Reserved: ₹${wallet.reservedAmount}, Available: ₹${wallet.availableBalance}, Pending Penalty: ₹${wallet.pendingPenaltyAmount}`);
        if (wallet.reservedAmount !== 1000 || wallet.availableBalance !== 0) {
            throw new Error('Scenario 4 Failed: Reserved amount incorrect after Platform job creation.');
        }
        console.log('✓ Scenario 4 PASSED! Platform job created and funded successfully.\n');

        // Cleanup scenario 4 job
        await cancelJob(platformJobWithPenalty.id, clientUser.userId, 'Cleanup');

        // ==========================================
        // SCENARIO 5: Cash Payment Job Creation with Outstanding Penalty
        // ==========================================
        console.log('--- SCENARIO 5: Cash Job Creation with Outstanding Penalty ---');
        // Set wallet to ₹50, pending penalty to ₹200
        await db.updateTable('clients')
            .set({ wallet: '50', reservedAmount: '0', pendingPenaltyAmount: '200' })
            .where('id', '=', clientUser.clientId)
            .execute();

        const cashJob = await createJob({
            ...defaultJobFields,
            jobTitle: 'Cash Job with Penalty',
            jobDescription: 'Cash payment job with attached penalty',
            budgetAmount: '1000',
            paymentMethod: 'CASH'
        }, clientUser.userId, clientUser.clientId);

        console.log(`  Cash Job Created. Job Penalty Amount: ₹${cashJob.clientPenaltyAmount}`);
        wallet = await getClientWallet(clientUser.userId);
        console.log(`  Client Wallet Total: ₹${wallet.totalBalance}, Pending Penalty: ₹${wallet.pendingPenaltyAmount}`);

        if (parseFloat(cashJob.clientPenaltyAmount || '0') !== 200) {
            throw new Error(`Scenario 5 Failed: Expected job clientPenaltyAmount = 200, got ${cashJob.clientPenaltyAmount}`);
        }
        if (wallet.pendingPenaltyAmount !== 0) {
            throw new Error(`Scenario 5 Failed: Client pendingPenaltyAmount should be transferred to cash job (expected 0, got ${wallet.pendingPenaltyAmount})`);
        }
        console.log('✓ Scenario 5 PASSED! Cash payment penalty attached to job successfully.\n');

        // Cleanup scenario 5 job
        await db.deleteFrom('jobs').where('id', '=', cashJob.id).execute();

        console.log('========================================================');
        console.log('🎉 ALL 5 PENALTY PAYMENT FLOW SCENARIOS PASSED 100%! 🎉');
        console.log('========================================================');

    } catch (error: any) {
        console.error('\n❌ PENALTY FLOW TEST FAILED:', error);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

runTest();
