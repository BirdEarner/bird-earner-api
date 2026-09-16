import 'dotenv/config';
import { db } from '../lib/db';
import { requestScopePriceChange, respondToScopePriceChange } from '../lib/services/jobs';

async function testSinglePriceChangeLimit() {
    console.log('=========================================================');
    console.log('🧪 TESTING SINGLE PRICE CHANGE REQUEST PER JOB LIMIT');
    console.log('=========================================================');

    const clientUser = await db.selectFrom('users').innerJoin('clients', 'clients.userId', 'users.id').select(['users.id as userId', 'clients.id as clientId']).executeTakeFirst();
    const freelancerUser = await db.selectFrom('users').innerJoin('freelancers', 'freelancers.userId', 'users.id').select(['users.id as userId', 'freelancers.id as freelancerId']).executeTakeFirst();

    if (!clientUser || !freelancerUser) {
        console.error('Test users not found');
        process.exit(1);
    }

    const jobId = crypto.randomUUID();
    const now = new Date();

    // Create active on-site job with verified OTP
    await db.insertInto('jobs').values({
        id: jobId,
        jobTitle: 'Single Price Change Limit Test Job',
        jobDescription: 'Testing 1 price change limit',
        jobCategory: 'Home Services',
        jobSubCategory: 'Electrical',
        skillsRequired: JSON.stringify(['Electrical']),
        projectType: 'on-site',
        budgetType: 'fixed',
        budgetAmount: '2000.00',
        clientId: clientUser.clientId,
        assignedFreelancerId: freelancerUser.freelancerId,
        paymentMethod: 'PLATFORM',
        jobStatus: 'JOB_STARTED',
        paymentStatus: 'RESERVED',
        isAmountReserved: true,
        location: 'Delhi',
        otpCode: '9999',
        otpVerifiedAt: now,
        confirmedAt: now,
        updatedAt: now,
    }).execute();

    console.log('\n--- 1. First price change request (₹2000 -> ₹2500) ---');
    await requestScopePriceChange(jobId, freelancerUser.userId, 2500, 'Extra wiring required');
    console.log('✅ First request submitted successfully');

    console.log('\n--- 2. Attempt second price change request while first is pending ---');
    try {
        await requestScopePriceChange(jobId, freelancerUser.userId, 2800, 'Another price increase');
        console.error('❌ Failed: Second request should have been rejected!');
        process.exit(1);
    } catch (err: any) {
        console.log(`✅ Correctly rejected second request while pending -> "${err.message}"`);
    }

    console.log('\n--- 3. Client accepts first price change request ---');
    await respondToScopePriceChange(jobId, clientUser.userId, true);
    console.log('✅ First request accepted by client');

    console.log('\n--- 4. Attempt second price change request after first was accepted ---');
    try {
        await requestScopePriceChange(jobId, freelancerUser.userId, 3000, 'Trying third request');
        console.error('❌ Failed: Second request after acceptance should have been rejected!');
        process.exit(1);
    } catch (err: any) {
        console.log(`✅ Correctly rejected second request after acceptance -> "${err.message}"`);
    }

    console.log('\n=========================================================');
    console.log('🎉 SINGLE PRICE CHANGE LIMIT TEST PASSED SUCCESSFULLY!');
    console.log('=========================================================');
    process.exit(0);
}

testSinglePriceChangeLimit().catch((err) => {
    console.error('❌ Test error:', err);
    process.exit(1);
});
