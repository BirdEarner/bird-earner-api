import 'dotenv/config';
import { db } from '../lib/db';
import { createJob, assignFreelancer } from '../lib/services/jobs';
import { depositClientFunds, getClientWallet } from '../lib/services/wallet';

async function runNegotiatedAmountStrictFlowTest() {
    console.log('=================================================================================');
    console.log('🧪 TESTING STRICT PLATFORM PAYMENT NEGOTIATION FLOW (ADDITIONAL AMOUNT REQUIREMENT)');
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

        // Step 1: Client posts job with Original Budget = ₹1,000 (Platform Payment)
        console.log('--- STEP 1: Post Platform Job (Original Budget = ₹1,000) ---');
        // Give client ₹1,000 in wallet to create job
        await db.updateTable('clients')
            .set({ wallet: '1000', reservedAmount: '0', pendingPenaltyAmount: '0' })
            .where('id', '=', clientUser.clientId)
            .execute();

        const job = await createJob({
            ...defaultJobFields,
            jobTitle: 'Negotiation Platform Test Job',
            jobDescription: 'Testing negotiated price > original budget strict flow',
            budgetAmount: '1000',
            paymentMethod: 'PLATFORM'
        }, clientUser.userId, clientUser.clientId);

        console.log(`  Job Created! Job ID: ${job.id}`);
        let wallet = await getClientWallet(clientUser.userId);
        console.log(`  Client Wallet Total: ₹${wallet.totalBalance}, Reserved: ₹${wallet.reservedAmount}, Available: ₹${wallet.availableBalance}\n`);

        // Step 2: Freelancer applies & Negotiated Amount = ₹1,500 (Additional Amount = ₹500)
        console.log('--- STEP 2: Create Negotiation Chat Thread (Negotiated Amount = ₹1,500) ---');
        const threadId = crypto.randomUUID();
        await db.insertInto('chatThreads').values({
            id: threadId,
            jobId: job.id,
            clientId: clientUser.clientId,
            freelancerId: freelancerUser.freelancerId,
            clientOffer: '1000',
            freelancerOffer: '1500',
            agreedAmount: '1500',
            status: 'PENDING',
            updatedAt: new Date()
        }).execute();

        console.log('  Chat Thread created. Negotiated Amount: ₹1,500 (Original: ₹1,000 -> Additional Required: ₹500)\n');

        // Set client's remaining wallet available balance to ₹200 (< ₹500 additional required)
        // Currently: wallet = 1,000, reserved = 1,000. Set wallet = 1,200, reserved = 1,000 (Available = 200)
        console.log('--- STEP 3: Client Available Wallet Balance = ₹200 (< ₹500 Additional Required) ---');
        await db.updateTable('clients')
            .set({ wallet: '1200', reservedAmount: '1000' })
            .where('id', '=', clientUser.clientId)
            .execute();

        wallet = await getClientWallet(clientUser.userId);
        console.log(`  Client Available Balance: ₹${wallet.availableBalance} (Shortfall: ₹300)\n`);

        // Attempt assignment with insufficient wallet (Available ₹200 < Additional ₹500)
        console.log('--- STEP 4: Attempt Freelancer Assignment with Insufficient Balance ---');
        const assignResult = await assignFreelancer(job.id, freelancerUser.freelancerId, clientUser.userId);

        console.log('  Assign Result:', assignResult);

        if (!assignResult || !(assignResult as any).requiresPayment) {
            throw new Error('Step 4 Failed: Assignment should be BLOCKED with requiresPayment: true');
        }

        // Verify Job was NOT assigned in DB
        const jobCheck = await db.selectFrom('jobs')
            .select(['jobStatus', 'assignedFreelancerId'])
            .where('id', '=', job.id)
            .executeTakeFirst();

        console.log(`  DB Job Status: ${jobCheck?.jobStatus}, Assigned Freelancer: ${jobCheck?.assignedFreelancerId}`);

        if (jobCheck?.jobStatus !== 'OPEN' || jobCheck?.assignedFreelancerId !== null) {
            throw new Error('Step 4 Failed: Job was incorrectly assigned in DB when wallet balance was insufficient!');
        }

        console.log('✓ STEP 4 VERIFIED PASSED: Assignment strictly BLOCKED & job remains OPEN!\n');

        // Step 5: Client deposits shortfall (₹300) into wallet via Pay BirdEarner
        console.log('--- STEP 5: Client Deposits Shortfall (₹300) into Wallet ---');
        await depositClientFunds(clientUser.userId, 300, 'Add funds for negotiated amount');

        wallet = await getClientWallet(clientUser.userId);
        console.log(`  New Available Balance: ₹${wallet.availableBalance} (Now >= ₹500 Additional Required)\n`);

        // Step 6: Retry Freelancer Assignment now that wallet available balance (500) >= Additional Amount (500)
        console.log('--- STEP 6: Retry Freelancer Assignment after Payment ---');
        const retryResult = await assignFreelancer(job.id, freelancerUser.freelancerId, clientUser.userId);

        const assignedJob = await db.selectFrom('jobs')
            .select(['jobStatus', 'assignedFreelancerId', 'negotiatedAmount'])
            .where('id', '=', job.id)
            .executeTakeFirst();

        console.log(`  DB Job Status: ${assignedJob?.jobStatus}, Assigned Freelancer: ${assignedJob?.assignedFreelancerId}, Negotiated Amount: ₹${assignedJob?.negotiatedAmount}`);

        wallet = await getClientWallet(clientUser.userId);
        console.log(`  Final Client Wallet Total: ₹${wallet.totalBalance}, Reserved: ₹${wallet.reservedAmount}, Available: ₹${wallet.availableBalance}`);

        if (assignedJob?.jobStatus !== 'CONFIRMED' || assignedJob?.assignedFreelancerId !== freelancerUser.freelancerId) {
            throw new Error('Step 6 Failed: Job should be CONFIRMED and freelancer assigned after successful payment!');
        }

        if (wallet.reservedAmount !== 1500) {
            throw new Error(`Step 6 Failed: Reserved amount should be ₹1,500, got ₹${wallet.reservedAmount}`);
        }

        console.log('✓ STEP 6 VERIFIED PASSED: Freelancer successfully assigned after payment!\n');

        // Cleanup test job & chat thread
        await db.deleteFrom('negotiationHistory').where('chatThreadId', '=', threadId).execute();
        await db.deleteFrom('chatThreads').where('id', '=', threadId).execute();
        await db.deleteFrom('jobs').where('id', '=', job.id).execute();

        console.log('=================================================================================');
        console.log('🎉 STRICT PLATFORM PAYMENT NEGOTIATION FLOW TEST PASSED 100%! 🎉');
        console.log('=================================================================================');

    } catch (error: any) {
        console.error('\n❌ NEGOTIATION STRICT FLOW TEST FAILED:', error);
        process.exit(1);
    } finally {
        process.exit(0);
    }
}

runNegotiatedAmountStrictFlowTest();
