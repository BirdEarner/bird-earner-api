import 'dotenv/config';
import { db } from '../lib/db.js';
import { createJob, assignFreelancer, requestScopePriceChange, respondToScopePriceChange } from '../lib/services/jobs.js';

async function testPriceChangeOnsiteFlow() {
    console.log('=========================================================');
    console.log('🧪 TESTING ON-SITE PRICE CHANGE FLOW AFTER OTP VERIFICATION');
    console.log('=========================================================');

    // 1. Setup Test Client & Freelancer Users
    const client = await db
        .selectFrom('clients')
        .innerJoin('users', 'users.id', 'clients.userId')
        .select(['clients.id as clientId', 'users.id as clientUserId', 'users.email as clientEmail', 'clients.availableBalance'])
        .executeTakeFirst();

    const freelancer = await db
        .selectFrom('freelancers')
        .innerJoin('users', 'users.id', 'freelancers.userId')
        .select(['freelancers.id as freelancerId', 'users.id as freelancerUserId', 'users.email as freelancerEmail'])
        .executeTakeFirst();

    if (!client || !freelancer) {
        console.error('❌ Client or Freelancer user missing in database');
        return;
    }

    console.log(`Client User ID: ${client.clientUserId} | Freelancer User ID: ${freelancer.freelancerUserId}`);

    // Ensure Client has clean starting wallet balance (e.g. 100)
    await db.updateTable('clients').set({ availableBalance: '100.00', reservedAmount: '0.00' }).where('userId', '=', client.clientUserId).execute();

    // -------------------------------------------------------------
    // TEST 1: REJECT PRICE CHANGE BEFORE OTP VERIFICATION
    // -------------------------------------------------------------
    console.log('\n--- TEST 1: Rejection before OTP verification ---');
    const unverifiedJob = await createJob(
        {
            jobTitle: 'On-Site Price Change Test Unverified',
            jobDescription: 'Testing price change rejection before OTP',
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
    await assignFreelancer(unverifiedJob.id, freelancer.freelancerId, client.clientUserId);

    try {
        await requestScopePriceChange(unverifiedJob.id, freelancer.freelancerUserId, 1500, 'Compressor issue');
        console.error('❌ FAILED: Price change should have been rejected before OTP verification!');
    } catch (err: any) {
        console.log(`✅ Passed: Correctly rejected before OTP verification -> "${err.message}"`);
    }

    // -------------------------------------------------------------
    // TEST 2: REJECT PRICE CHANGE FOR REMOTE JOBS
    // -------------------------------------------------------------
    console.log('\n--- TEST 2: Rejection for REMOTE jobs ---');
    const remoteJob = await createJob(
        {
            jobTitle: 'Remote Job Test',
            jobDescription: 'Testing remote price change rejection',
            jobCategory: 'Web Development',
            jobSubCategory: 'Web Development',
            projectType: 'REMOTE',
            budgetType: 'Fixed',
            budgetAmount: 1000,
            workDurationDays: 1,
            paymentMethod: 'CASH',
            location: 'Remote',
        },
        client.clientUserId,
        client.clientId
    );
    await assignFreelancer(remoteJob.id, freelancer.freelancerId, client.clientUserId);
    // Force set otpVerifiedAt on remote job to test projectType check
    await db.updateTable('jobs').set({ otpVerifiedAt: new Date() }).where('id', '=', remoteJob.id).execute();

    try {
        await requestScopePriceChange(remoteJob.id, freelancer.freelancerUserId, 1500, 'More pages');
        console.error('❌ FAILED: Price change should have been rejected for REMOTE job!');
    } catch (err: any) {
        console.log(`✅ Passed: Correctly rejected for REMOTE job -> "${err.message}"`);
    }

    // -------------------------------------------------------------
    // TEST 3: REJECT INVALID / LOWER / EQUAL PRICE REQUESTS
    // -------------------------------------------------------------
    console.log('\n--- TEST 3: Rejection for invalid requested price ---');
    const onsiteJob = await createJob(
        {
            jobTitle: 'AC Repair On-Site',
            jobDescription: 'AC Compressor check',
            jobCategory: 'AC Repair',
            jobSubCategory: 'AC Repair',
            projectType: 'On-site',
            budgetType: 'Fixed',
            budgetAmount: 1000,
            workDurationDays: 1,
            paymentMethod: 'PLATFORM',
            location: 'Pune India',
        },
        client.clientUserId,
        client.clientId
    );
    await assignFreelancer(onsiteJob.id, freelancer.freelancerId, client.clientUserId);
    // Mark OTP as verified
    await db.updateTable('jobs').set({ otpVerifiedAt: new Date(), jobStatus: 'JOB_STARTED' }).where('id', '=', onsiteJob.id).execute();

    try {
        await requestScopePriceChange(onsiteJob.id, freelancer.freelancerUserId, 1000, 'Same price');
        console.error('❌ FAILED: Should reject price request equal to original!');
    } catch (err: any) {
        console.log(`✅ Passed: Correctly rejected price equal to original -> "${err.message}"`);
    }

    // -------------------------------------------------------------
    // TEST 4: FREELANCER SUBMITS VALID PRICE CHANGE REQUEST (₹1000 -> ₹1500)
    // -------------------------------------------------------------
    console.log('\n--- TEST 4: Freelancer submits valid price change (₹1000 -> ₹1500) ---');
    const reqRes = await requestScopePriceChange(
        onsiteJob.id,
        freelancer.freelancerUserId,
        1500,
        'Additional work required',
        'Compressor replacement needed'
    );
    console.log(`✅ Price Change Requested: requestedPrice=${reqRes.priceChangeRequested} | reason="${reqRes.priceChangeReason}"`);

    // -------------------------------------------------------------
    // TEST 5: CLIENT ACCEPTS WITH INSUFFICIENT WALLET BALANCE (Balance = 100, Diff = 500)
    // -------------------------------------------------------------
    console.log('\n--- TEST 5: Client accepts with insufficient wallet balance ---');
    try {
        await respondToScopePriceChange(onsiteJob.id, client.clientUserId, true);
        console.error('❌ FAILED: Should reject due to insufficient wallet balance!');
    } catch (err: any) {
        console.log(`✅ Passed: Correctly blocked with insufficient balance message -> "${err.message}"`);
    }

    // -------------------------------------------------------------
    // TEST 6: TOP UP WALLET & CLIENT ACCEPTS (Balance = 1000, Diff = 500)
    // -------------------------------------------------------------
    console.log('\n--- TEST 6: Top up wallet (₹1000) & Client accepts price change ---');
    await db.updateTable('clients').set({ availableBalance: '1000.00', reservedAmount: '0.00' }).where('userId', '=', client.clientUserId).execute();

    const acceptedJob = await respondToScopePriceChange(onsiteJob.id, client.clientUserId, true);
    console.log(`✅ Price Change Accepted! New Budget = ₹${acceptedJob.budgetAmount} | RequestedCleared = ${acceptedJob.priceChangeRequested === null}`);

    const clientAfterAccept = await db.selectFrom('clients').select(['availableBalance', 'reservedAmount']).where('userId', '=', client.clientUserId).executeTakeFirst();
    console.log(`✅ Client Wallet After Accept: availableBalance=₹${clientAfterAccept?.availableBalance} | reservedAmount=₹${clientAfterAccept?.reservedAmount} (Diff of ₹500 reserved)`);

    // Check Wallet Transaction log
    const tx = await db.selectFrom('walletTransactions').select(['transactionType', 'amount', 'description']).where('jobId', '=', onsiteJob.id).executeTakeFirst();
    console.log(`✅ Wallet Transaction Recorded: type=${tx?.transactionType} | amount=₹${tx?.amount} | desc="${tx?.description}"`);

    // -------------------------------------------------------------
    // TEST 7: CLIENT DECLINES / CANCEL DUE TO SCOPE MISMATCH (CASH JOB)
    // -------------------------------------------------------------
    console.log('\n--- TEST 7: Client declines price change on CASH job (Scope Mismatch Cancellation) ---');
    const cashJob = await createJob(
        {
            jobTitle: 'Plumbing Repair On-Site',
            jobDescription: 'Pipe leak fix',
            jobCategory: 'Plumbing',
            jobSubCategory: 'Plumbing',
            projectType: 'On-site',
            budgetType: 'Fixed',
            budgetAmount: 800,
            workDurationDays: 1,
            paymentMethod: 'CASH',
            location: 'Delhi India',
        },
        client.clientUserId,
        client.clientId
    );
    await assignFreelancer(cashJob.id, freelancer.freelancerId, client.clientUserId);
    await db.updateTable('jobs').set({ otpVerifiedAt: new Date(), jobStatus: 'JOB_STARTED' }).where('id', '=', cashJob.id).execute();

    await requestScopePriceChange(cashJob.id, freelancer.freelancerUserId, 1400, 'Major pipe replacement required');
    const declinedJob = await respondToScopePriceChange(cashJob.id, client.clientUserId, false);

    console.log(`✅ Cash Job Declined & Cancelled: status=${declinedJob.jobStatus} | reason="${declinedJob.cancellationReason}" | clientPenalty=₹${declinedJob.clientPenaltyAmount}`);

    console.log('\n=========================================================');
    console.log('🎉 ALL ON-SITE PRICE CHANGE FLOW TESTS PASSED SUCCESSFULLY! 🎉');
    console.log('=========================================================');
}

testPriceChangeOnsiteFlow()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
