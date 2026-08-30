import 'dotenv/config';
import { db } from '../lib/db';
import { generateToken } from '../lib/auth';

async function testInsufficientBalanceError() {
    console.log('Testing create job insufficient balance error response...');

    const client = await db
        .selectFrom('clients')
        .innerJoin('users', 'users.id', 'clients.userId')
        .select(['clients.id as clientId', 'users.id as userId', 'users.email'])
        .executeTakeFirst();

    if (!client) {
        console.log('No test client found.');
        return;
    }

    const token = generateToken({
        id: client.userId,
        email: client.email,
        role: 'user',
    });

    const res = await fetch('http://localhost:3001/api/jobs', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            jobTitle: 'Insufficient Balance Test Job Title',
            jobDescription: 'Testing proper 400 Bad Request error response when client has insufficient wallet balance',
            jobCategory: 'AC Repair',
            jobSubCategory: 'AC Repair',
            projectType: 'On-site',
            budgetType: 'Fixed',
            budgetAmount: 999999, // Extremely high budget to guarantee insufficient balance
            paymentMethod: 'PLATFORM',
        }),
    });

    console.log('HTTP Status:', res.status);
    const data = await res.json();
    console.log('Response JSON:', data);

    if (res.status === 400 && data.message?.includes('Insufficient wallet balance')) {
        console.log('✅ TEST PASSED: API cleanly returned HTTP 400 Bad Request with user-friendly error message!');
    } else {
        console.error('❌ TEST FAILED: Unexpected status or message format', res.status, data);
    }
}

testInsufficientBalanceError()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
