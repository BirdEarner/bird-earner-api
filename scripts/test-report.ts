import 'dotenv/config';
import { db } from '../lib/db';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';

async function testReportSubmission() {
    console.log('--- TESTING CHAT REPORT SUBMISSION ---');

    // 1. Get test user
    const testUser = await db
        .selectFrom('users')
        .select(['id', 'email'])
        .executeTakeFirst();

    if (!testUser) {
        console.error('No test user found in database!');
        process.exit(1);
    }

    console.log(`[SETUP] Test User ID: ${testUser.id}, Email: ${testUser.email}`);

    // 2. Generate Auth Token
    const JWT_SECRET = process.env.JWT_SECRET || 'bird_earner_jwt_secret_key_make_it_long_and_secure_for_production_use';
    const token = jwt.sign(
        { id: testUser.id, email: testUser.email, role: 'CLIENT' },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    // 3. Call POST /api/chats/report
    const PORT = process.env.PORT || '3001';
    const apiUrl = `http://localhost:${PORT}/api/chats/report`;
    console.log(`[CALL API] POST ${apiUrl}`);

    const res = await fetch(apiUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            threadId: 'test_thread_123',
            reason: 'Spam',
            reportedUserId: testUser.id,
            details: 'Testing report submission endpoint',
        }),
    });

    console.log(`[API RESPONSE] Status: ${res.status}`);
    const jsonResult: any = await res.json();
    console.log(`[API RESPONSE] Body:`, jsonResult);

    if (res.ok && jsonResult.success && jsonResult.data?.ticketId) {
        console.log(`[VERIFY DB] Checking contacts table for ticket: ${jsonResult.data.ticketId}`);
        const contactRecord = await db
            .selectFrom('contacts')
            .selectAll()
            .where('ticketId', '=', jsonResult.data.ticketId)
            .executeTakeFirst();

        if (contactRecord) {
            console.log('🎉 REPORT SUBMISSION TEST 100% PASSED! 🎉');
            process.exit(0);
        }
    }

    console.error('❌ Report submission test FAILED!');
    process.exit(1);
}

testReportSubmission().catch((err) => {
    console.error('Test error:', err);
    process.exit(1);
});
