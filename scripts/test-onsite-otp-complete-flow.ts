import 'dotenv/config';
import { db } from '../lib/db';
import { createJob, assignFreelancer } from '../lib/services/jobs';
import { generateToken } from '../lib/auth';

async function testOnSiteOtpCompleteFlow() {
    console.log('=========================================================');
    console.log('🧪 TESTING COMPLETE ON-SITE OTP FLOW (CLIENT & FREELANCER)');
    console.log('=========================================================');

    // 1. Setup Test Client & Freelancer Users
    const client = await db
        .selectFrom('clients')
        .innerJoin('users', 'users.id', 'clients.userId')
        .select(['clients.id as clientId', 'users.id as clientUserId', 'users.email as clientEmail'])
        .executeTakeFirst();

    const freelancer = await db
        .selectFrom('freelancers')
        .innerJoin('users', 'users.id', 'freelancers.userId')
        .select(['freelancers.id as freelancerId', 'users.id as freelancerUserId', 'users.email as freelancerEmail'])
        .executeTakeFirst();

    if (!client || !freelancer) {
        console.error('Client or Freelancer user missing');
        return;
    }

    const clientToken = generateToken({ id: client.clientUserId, email: client.clientEmail, role: 'user' });
    const freelancerToken = generateToken({ id: freelancer.freelancerUserId, email: freelancer.freelancerEmail, role: 'user' });

    // 2. Create On-Site Cash Job
    console.log('\n1. Creating On-Site Cash Job...');
    const job = await createJob(
        {
            jobTitle: 'On-Site OTP Full Flow Test',
            jobDescription: 'Testing end-to-end OTP workflow between Client and Freelancer',
            jobCategory: 'AC Repair',
            jobSubCategory: 'AC Repair',
            projectType: 'On-site',
            budgetType: 'Fixed',
            budgetAmount: 1000,
            workDurationDays: 1,
            paymentMethod: 'CASH',
            location: 'Pune Maharashtra India',
        },
        client.clientUserId,
        client.clientId
    );
    console.log(`✅ Job Created: ID=${job.id} | Status=${job.jobStatus}`);

    // 3. Assign Freelancer
    console.log('\n2. Assigning Freelancer to Job...');
    await assignFreelancer(job.id, freelancer.freelancerId, client.clientUserId);
    let jobDB = await db.selectFrom('jobs').select(['jobStatus', 'otpCode']).where('id', '=', job.id).executeTakeFirst();
    console.log(`✅ Freelancer Assigned | Status=${jobDB?.jobStatus}`);

    // 4. Step 1: Freelancer Marks "I'm On My Way" (TRAVELLING)
    console.log('\n3. Step 1: Freelancer marks "I\'m On My Way" (TRAVELLING)...');
    let res = await fetch(`http://localhost:3001/api/jobs/${job.id}/progress`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${freelancerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'TRAVELLING' }),
    });
    console.log('HTTP Status:', res.status);
    jobDB = await db.selectFrom('jobs').select(['jobStatus', 'otpCode']).where('id', '=', job.id).executeTakeFirst();
    console.log(`✅ Updated Status=${jobDB?.jobStatus} | OTP Code=${jobDB?.otpCode || 'None (Correct: Not requested yet)'}`);

    // 5. Step 2: Freelancer Marks "I Have Arrived" (ARRIVED / REQUEST_OTP)
    console.log('\n4. Step 2: Freelancer marks "I Have Arrived" (ARRIVED / REQUEST_OTP)...');
    res = await fetch(`http://localhost:3001/api/jobs/${job.id}/progress`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${freelancerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'ARRIVED' }),
    });
    console.log('HTTP Status:', res.status);
    jobDB = await db.selectFrom('jobs').select(['jobStatus', 'otpCode']).where('id', '=', job.id).executeTakeFirst();
    console.log(`✅ Updated Status=${jobDB?.jobStatus} | Generated OTP Code="${jobDB?.otpCode}"`);

    if (!jobDB?.otpCode) {
        console.error('❌ FAILED: OTP code was not generated on ARRIVED status!');
        return;
    }

    const generatedOtp = jobDB.otpCode;

    // 6. Step 3: Client Checks OTP ("Show OTP")
    console.log('\n5. Step 3: Client fetches job details ("Show OTP")...');
    const jobFetchRes = await fetch(`http://localhost:3001/api/jobs/${job.id}`, {
        headers: { Authorization: `Bearer ${clientToken}` },
    });
    const jobFetchJson = await jobFetchRes.json();
    const clientOtpCode = jobFetchJson.data?.otpCode || jobFetchJson.otpCode;
    console.log(`✅ Client received OTP Code: "${clientOtpCode}" (Matches Generated: ${clientOtpCode === generatedOtp})`);

    // 7. Step 4: Freelancer Verifies OTP (VERIFY_OTP)
    console.log(`\n6. Step 4: Freelancer submits OTP "${generatedOtp}" to start work (VERIFY_OTP)...`);
    res = await fetch(`http://localhost:3001/api/jobs/${job.id}/progress`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${freelancerToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'VERIFY_OTP', otpCode: generatedOtp }),
    });
    console.log('HTTP Status:', res.status);
    const verifyJson = await res.json();
    console.log('Response:', verifyJson.message);

    jobDB = await db
        .selectFrom('jobs')
        .select(['jobStatus', 'otpVerifiedAt', 'postOtpCancellationWindowExpiresAt'])
        .where('id', '=', job.id)
        .executeTakeFirst();

    console.log(`✅ Final Status=${jobDB?.jobStatus}`);
    console.log(`✅ OTP Verified At=${jobDB?.otpVerifiedAt}`);
    console.log(`✅ Emergency Cancel Window Expires At=${jobDB?.postOtpCancellationWindowExpiresAt}`);

    if (jobDB?.jobStatus === 'JOB_STARTED' && jobDB?.otpVerifiedAt) {
        console.log('\n=========================================================');
        console.log('🎉 COMPLETE ON-SITE OTP FLOW VERIFIED SUCCESSFULLY! 🎉');
        console.log('=========================================================');
    } else {
        console.error('❌ TEST FAILED: Job status not set to JOB_STARTED');
    }
}

testOnSiteOtpCompleteFlow()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
