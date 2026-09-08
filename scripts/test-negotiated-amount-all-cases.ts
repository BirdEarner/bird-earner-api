import 'dotenv/config';
import { db } from '../lib/db';
import { createJob, assignFreelancer } from '../lib/services/jobs';
import { depositClientFunds, getClientWallet } from '../lib/services/wallet';

async function runNegotiatedAmountAllCasesTest() {
    console.log('=================================================================================');
    console.log('🧪 COMPREHENSIVE TEST: PLATFORM PAYMENT NEGOTIATED AMOUNT RULES (ALL 3 CASES)');
    console.log('=================================================================================\n');

    const defaultJobFields = {
        jobCategory: 'Development',
        jobSubCategory: 'Web Development',
        projectType: 'Remote',
        budgetType: 'Fixed',
    };

    try {
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

        // =====================================================================
        // CASE 1: Negotiated Amount == Actual Job Amount (e.g., ₹1,000 == ₹1,000)
        // =====================================================================
        console.log('--- CASE 1: Negotiated Amount == Actual Job Amount (₹1,000 == ₹1,000) ---');
        await db.updateTable('clients')
            .set({ wallet: '1000', reservedAmount: '0', pendingPenaltyAmount: '0' })
            .where('id', '=', clientUser.clientId)
            .execute();

        const jobCase1 = await createJob({
            ...defaultJobFields,
            jobTitle: 'Negotiation Case 1 Job',
            jobDescription: 'Testing negotiated amount equal to budget',
            budgetAmount: '1000',
            paymentMethod: 'PLATFORM'
        }, clientUser.userId, clientUser.clientId);

        const threadId1 = crypto.randomUUID();
        await db.insertInto('chatThreads').values({
            id: threadId1,
            jobId: jobCase1.id,
            clientId: clientUser.clientId,
            freelancerId: freelancerUser.freelancerId,
            clientOffer: '1000',
            freelancerOffer: '1000',
            agreedAmount: '1000',
            status: 'PENDING',
            updatedAt: new Date()
        }).execute();

        const assignRes1 = await assignFreelancer(jobCase1.id, freelancerUser.freelancerId, clientUser.userId);
        const jobCheck1 = await db.selectFrom('jobs')
            .select(['jobStatus', 'assignedFreelancerId', 'negotiatedAmount'])
            .where('id', '=', jobCase1.id)
            .executeTakeFirst();

        console.log(`  Job Status: ${jobCheck1?.jobStatus}, Assigned Freelancer: ${jobCheck1?.assignedFreelancerId}`);
        if (jobCheck1?.jobStatus !== 'CONFIRMED' || jobCheck1?.assignedFreelancerId !== freelancerUser.freelancerId) {
            throw new Error('Case 1 Failed: Job should be simply assigned to freelancer when negotiated == budget');
        }
        console.log('✓ CASE 1 VERIFIED PASSED: Simply assigned freelancer when negotiated == budget!\n');

        // Cleanup Case 1
        await db.deleteFrom('negotiationHistory').where('chatThreadId', '=', threadId1).execute();
        await db.deleteFrom('chatThreads').where('id', '=', threadId1).execute();
        await db.deleteFrom('jobs').where('id', '=', jobCase1.id).execute();

        // =====================================================================
        // CASE 2: Negotiated Amount > Actual Job Amount & Wallet Available >= Additional Amount
        // =====================================================================
        console.log('--- CASE 2: Negotiated Amount > Budget & Wallet Available >= Additional Amount ---');
        // Budget = ₹1,000, Negotiated = ₹1,500 -> Additional Required = ₹500.
        // Set client wallet = ₹1,500, reserved = ₹0 -> Available balance = ₹1,500 (>= ₹500).
        await db.updateTable('clients')
            .set({ wallet: '1500', reservedAmount: '0', pendingPenaltyAmount: '0' })
            .where('id', '=', clientUser.clientId)
            .execute();

        const jobCase2 = await createJob({
            ...defaultJobFields,
            jobTitle: 'Negotiation Case 2 Job',
            jobDescription: 'Testing negotiated amount > budget with sufficient wallet',
            budgetAmount: '1000',
            paymentMethod: 'PLATFORM'
        }, clientUser.userId, clientUser.clientId);

        let wallet = await getClientWallet(clientUser.userId);
        console.log(`  Post Job Creation: Wallet = ₹${wallet.totalBalance}, Reserved = ₹${wallet.reservedAmount}, Available = ₹${wallet.availableBalance}`);

        const threadId2 = crypto.randomUUID();
        await db.insertInto('chatThreads').values({
            id: threadId2,
            jobId: jobCase2.id,
            clientId: clientUser.clientId,
            freelancerId: freelancerUser.freelancerId,
            clientOffer: '1000',
            freelancerOffer: '1500',
            agreedAmount: '1500',
            status: 'PENDING',
            updatedAt: new Date()
        }).execute();

        const assignRes2 = await assignFreelancer(jobCase2.id, freelancerUser.freelancerId, clientUser.userId);
        const jobCheck2 = await db.selectFrom('jobs')
            .select(['jobStatus', 'assignedFreelancerId', 'negotiatedAmount'])
            .where('id', '=', jobCase2.id)
            .executeTakeFirst();

        wallet = await getClientWallet(clientUser.userId);
        console.log(`  Post Assignment: Job Status = ${jobCheck2?.jobStatus}, Reserved = ₹${wallet.reservedAmount}, Available = ₹${wallet.availableBalance}`);

        if (jobCheck2?.jobStatus !== 'CONFIRMED' || wallet.reservedAmount !== 1500) {
            throw new Error('Case 2 Failed: Wallet amount was not deducted/reserved immediately upon assignment.');
        }
        console.log('✓ CASE 2 VERIFIED PASSED: Additional ₹500 deducted/reserved immediately & freelancer assigned!\n');

        // Cleanup Case 2
        await db.deleteFrom('negotiationHistory').where('chatThreadId', '=', threadId2).execute();
        await db.deleteFrom('chatThreads').where('id', '=', threadId2).execute();
        await db.deleteFrom('jobs').where('id', '=', jobCase2.id).execute();

        // =====================================================================
        // CASE 3: Negotiated Amount > Actual Job Amount & Wallet Available < Additional Amount
        // =====================================================================
        console.log('--- CASE 3: Negotiated Amount > Budget & Wallet Available < Additional Amount ---');
        // Budget = ₹1,000, Negotiated = ₹1,500 -> Additional Required = ₹500.
        // Set client wallet = ₹1,200, reserved = ₹1,000 -> Available balance = ₹200 (< ₹500).
        await db.updateTable('clients')
            .set({ wallet: '1200', reservedAmount: '0', pendingPenaltyAmount: '0' })
            .where('id', '=', clientUser.clientId)
            .execute();

        const jobCase3 = await createJob({
            ...defaultJobFields,
            jobTitle: 'Negotiation Case 3 Job',
            jobDescription: 'Testing negotiated amount > budget with insufficient wallet',
            budgetAmount: '1000',
            paymentMethod: 'PLATFORM'
        }, clientUser.userId, clientUser.clientId);

        wallet = await getClientWallet(clientUser.userId);
        console.log(`  Post Job Creation: Wallet = ₹${wallet.totalBalance}, Reserved = ₹${wallet.reservedAmount}, Available = ₹${wallet.availableBalance}`);

        const threadId3 = crypto.randomUUID();
        await db.insertInto('chatThreads').values({
            id: threadId3,
            jobId: jobCase3.id,
            clientId: clientUser.clientId,
            freelancerId: freelancerUser.freelancerId,
            clientOffer: '1000',
            freelancerOffer: '1500',
            agreedAmount: '1500',
            status: 'PENDING',
            updatedAt: new Date()
        }).execute();

        // 3A. Attempt Assignment -> MUST BE STRICTLY BLOCKED
        const assignRes3 = await assignFreelancer(jobCase3.id, freelancerUser.freelancerId, clientUser.userId);
        console.log('  Assign Attempt Result:', assignRes3);

        if (!assignRes3 || !(assignRes3 as any).requiresPayment) {
            throw new Error('Case 3 Failed: Assignment should be blocked with requiresPayment: true');
        }

        const jobCheck3 = await db.selectFrom('jobs')
            .select(['jobStatus', 'assignedFreelancerId'])
            .where('id', '=', jobCase3.id)
            .executeTakeFirst();

        console.log(`  DB Job Status: ${jobCheck3?.jobStatus}, Assigned Freelancer: ${jobCheck3?.assignedFreelancerId}`);

        if (jobCheck3?.jobStatus !== 'OPEN' || jobCheck3?.assignedFreelancerId !== null) {
            throw new Error('Case 3 Failed: Job was assigned to freelancer despite insufficient wallet balance!');
        }
        console.log('✓ CASE 3A VERIFIED PASSED: Assignment strictly BLOCKED & job remains OPEN!');

        // 3B. Client pays shortfall (₹300) to Pay BirdEarner
        console.log('  Client pays shortfall ₹300 via Pay BirdEarner...');
        await depositClientFunds(clientUser.userId, 300, 'Shortfall deposit for Case 3');

        wallet = await getClientWallet(clientUser.userId);
        console.log(`  New Available Balance: ₹${wallet.availableBalance} (Now >= ₹500)`);

        // 3C. Retry assignment after payment -> MUST SUCCEED NOW
        const retryRes3 = await assignFreelancer(jobCase3.id, freelancerUser.freelancerId, clientUser.userId);
        const finalJobCheck3 = await db.selectFrom('jobs')
            .select(['jobStatus', 'assignedFreelancerId', 'negotiatedAmount'])
            .where('id', '=', jobCase3.id)
            .executeTakeFirst();

        wallet = await getClientWallet(clientUser.userId);
        console.log(`  Post Payment Assignment: Status = ${finalJobCheck3?.jobStatus}, Reserved = ₹${wallet.reservedAmount}`);

        if (finalJobCheck3?.jobStatus !== 'CONFIRMED' || wallet.reservedAmount !== 1500) {
            throw new Error('Case 3 Failed: Assignment failed after successful payment!');
        }
        console.log('✓ CASE 3B VERIFIED PASSED: Freelancer successfully assigned after payment completed!\n');

        // Cleanup Case 3
        await db.deleteFrom('negotiationHistory').where('chatThreadId', '=', threadId3).execute();
        await db.deleteFrom('chatThreads').where('id', '=', threadId3).execute();
        await db.deleteFrom('jobs').where('id', '=', jobCase3.id).execute();

        console.log('=================================================================================');
        console.log('🎉 ALL 3 PLATFORM PAYMENT NEGOTIATION CASES VERIFIED AND PASSED 100%! 🎉');
        console.log('=================================================================================');

    } catch (error: any) {
        console.error('\n❌ AUDIT TEST FAILED:', error);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

runNegotiatedAmountAllCasesTest();
