import 'dotenv/config';
import { db } from '../lib/db';
import { requestScopePriceChange, respondToScopePriceChange, cancelJob } from '../lib/services/jobs';
import { getClientWallet } from '../lib/services/wallet';

async function testPriceChangeCancelWindowFlow() {
    console.log('=========================================================');
    console.log('🧪 TESTING PRICE CHANGE ACCEPTANCE & IMMEDIATE CANCELLATION FLOW');
    console.log('=========================================================');

    const clientUser = await db.selectFrom('users').innerJoin('clients', 'clients.userId', 'users.id').select(['users.id as userId', 'clients.id as clientId']).executeTakeFirst();
    const freelancerUser = await db.selectFrom('users').innerJoin('freelancers', 'freelancers.userId', 'users.id').select(['users.id as userId', 'freelancers.id as freelancerId']).executeTakeFirst();

    if (!clientUser || !freelancerUser) {
        console.error('Test users not found');
        process.exit(1);
    }

    // Set client wallet to 5000
    await db.updateTable('clients').set({ wallet: '5000.00', reservedAmount: '0.00', availableBalance: '5000.00' }).where('id', '=', clientUser.clientId).execute();

    const initialWallet = await getClientWallet(clientUser.userId);
    console.log(`Client initial wallet: total=${initialWallet.totalBalance}, reserved=${initialWallet.reservedAmount}, available=${initialWallet.availableBalance}`);

    // Create an on-site job
    const jobId = crypto.randomUUID();
    const now = new Date();

    await db.insertInto('jobs').values({
        id: jobId,
        jobTitle: 'Test AC Repair OnSite Price Change Cancel',
        jobDescription: 'Onsite job description',
        jobCategory: 'Home Services',
        jobSubCategory: 'AC Repair',
        skillsRequired: JSON.stringify(['AC']),
        projectType: 'on-site',
        budgetType: 'fixed',
        budgetAmount: '1000.00',
        clientId: clientUser.clientId,
        assignedFreelancerId: freelancerUser.freelancerId,
        paymentMethod: 'PLATFORM',
        jobStatus: 'JOB_STARTED',
        paymentStatus: 'RESERVED',
        isAmountReserved: true,
        location: 'Mumbai',
        otpCode: '1234',
        otpVerifiedAt: now,
        confirmedAt: now,
        updatedAt: now,
    }).execute();

    // Reserve initial 1000
    await db.updateTable('clients').set({ reservedAmount: '1000.00', availableBalance: '4000.00' }).where('id', '=', clientUser.clientId).execute();

    console.log('\n--- STEP 1: Freelancer requests price change (₹1000 -> ₹1600) ---');
    await requestScopePriceChange(jobId, freelancerUser.userId, 1600, 'Extra parts needed', 'Heavy copper wire required');

    const jobAfterReq = await db.selectFrom('jobs').select(['priceChangeRequested', 'priceChangeReason']).where('id', '=', jobId).executeTakeFirst();
    console.log(`✅ Request recorded: requestedPrice=${jobAfterReq?.priceChangeRequested}`);

    console.log('\n--- STEP 2: Client accepts price change (₹1600) ---');
    await respondToScopePriceChange(jobId, clientUser.userId, true);

    const walletAfterAccept = await getClientWallet(clientUser.userId);
    console.log(`✅ Wallet after accept: reserved=${walletAfterAccept.reservedAmount} (expected 1600), available=${walletAfterBalance(walletAfterAccept)}`);

    if (walletAfterAccept.reservedAmount !== 1600) {
        throw new Error(`Expected reserved amount 1600, got ${walletAfterAccept.reservedAmount}`);
    }
    if (walletAfterAccept.availableBalance !== 3400) {
        throw new Error(`Expected available balance 3400, got ${walletAfterAccept.availableBalance}`);
    }

    const jobAfterAccept = await db.selectFrom('jobs').select(['budgetAmount', 'negotiatedAmount', 'postOtpCancellationWindowExpiresAt']).where('id', '=', jobId).executeTakeFirst();
    console.log(`✅ Job after accept: budgetAmount=${jobAfterAccept?.budgetAmount}, negotiatedAmount=${jobAfterAccept?.negotiatedAmount}`);
    console.log(`✅ 5-min post-OTP cancellation window expires at: ${jobAfterAccept?.postOtpCancellationWindowExpiresAt}`);

    console.log('\n--- STEP 3: Client cancels job within 1 minute of accepting price change ---');
    await cancelJob(jobId, clientUser.userId, 'Client changed mind within 1 minute of price change');

    const walletAfterCancel = await getClientWallet(clientUser.userId);
    console.log(`✅ Wallet after cancel: reserved=${walletAfterCancel.reservedAmount} (expected 0), available=${walletAfterCancel.availableBalance} (expected 5000)`);

    if (walletAfterCancel.reservedAmount !== 0) {
        throw new Error(`Expected reserved amount 0 after cancellation, got ${walletAfterCancel.reservedAmount}`);
    }
    if (walletAfterCancel.availableBalance !== 5000) {
        throw new Error(`Expected available balance 5000 after cancellation, got ${walletAfterCancel.availableBalance}`);
    }

    const jobAfterCancel = await db.selectFrom('jobs').select(['jobStatus', 'isAmountReserved']).where('id', '=', jobId).executeTakeFirst();
    console.log(`✅ Job status after cancel: ${jobAfterCancel?.jobStatus}, isAmountReserved=${jobAfterCancel?.isAmountReserved}`);

    console.log('\n=========================================================');
    console.log('🎉 ALL PRICE CHANGE ACCEPTANCE & CANCELLATION TESTS PASSED!');
    console.log('=========================================================');
    process.exit(0);
}

function walletAfterBalance(w: any) {
    return w.availableBalance;
}

testPriceChangeCancelWindowFlow().catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
