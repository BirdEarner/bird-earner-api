import 'dotenv/config';
import { db } from '../lib/db';
import { generateToken } from '../lib/auth';

const API_BASE_URL = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3001';

async function runEmailVerificationTests() {
    console.log('\n========================================================');
    console.log('  STARTING EMAIL VERIFICATION FLOW TEST SUITE');
    console.log(`  Base URL: ${API_BASE_URL}`);
    console.log('========================================================\n');

    let testUser1Id: string | null = null;
    let testUser2Id: string | null = null;

    try {
        // --- SETUP ---
        const testEmail1 = `test_email_verify_1_${Date.now()}@example.com`;
        const testToken1 = `token_valid_${Date.now()}`;
        const expiresFuture = String(Date.now() + 24 * 60 * 60 * 1000); // +24 hours

        console.log('[SETUP] Creating Test User 1 (Unverified)...');
        const user1 = await db.insertInto('users')
            .values({
                id: crypto.randomUUID(),
                email: testEmail1,
                fullName: 'Test Email Verification User 1',
                isEmailVerified: false,
                emailVerificationToken: testToken1,
                emailVerificationExpires: expiresFuture,
                updatedAt: new Date(),
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        testUser1Id = user1.id;
        console.log(`✓ Test User 1 created. ID: ${user1.id}, Token: ${testToken1}`);

        // --- TEST 1: Valid Verification Link ---
        console.log('\n--- TEST 1: Verify Email with Valid Token ---');
        const res1 = await fetch(`${API_BASE_URL}/api/auth/verify-email-link?token=${testToken1}`);
        const data1 = await res1.json();
        console.log(`Status: ${res1.status}`);
        console.log('Response:', data1);

        if (res1.status !== 200 || !data1.success || data1.message !== 'Email verified successfully') {
            throw new Error(`Test 1 Failed! Expected success: true, got ${JSON.stringify(data1)}`);
        }

        // Check DB status
        const dbUser1 = await db.selectFrom('users')
            .select(['isEmailVerified'])
            .where('id', '=', user1.id)
            .executeTakeFirst();
        if (!dbUser1?.isEmailVerified) {
            throw new Error('Test 1 Failed! User isEmailVerified is still false in database');
        }
        console.log('✓ TEST 1 PASSED! Email verified successfully and updated in DB.');

        // --- TEST 2: Re-verify Already Verified Email ---
        console.log('\n--- TEST 2: Re-verify Already Verified Token ---');
        const res2 = await fetch(`${API_BASE_URL}/api/auth/verify-email-link?token=${testToken1}`);
        const data2 = await res2.json();
        console.log(`Status: ${res2.status}`);
        console.log('Response:', data2);

        if (res2.status !== 200 || !data2.success || data2.message !== 'Email already verified') {
            throw new Error(`Test 2 Failed! Expected 'Email already verified', got ${JSON.stringify(data2)}`);
        }
        console.log('✓ TEST 2 PASSED! Handled already verified token correctly.');

        // --- TEST 3: Expired Verification Link ---
        console.log('\n--- TEST 3: Expired Verification Link ---');
        const testEmail2 = `test_email_verify_2_${Date.now()}@example.com`;
        const testToken2 = `token_expired_${Date.now()}`;
        const expiresPast = String(Date.now() - 3600000); // 1 hour ago

        console.log('[SETUP] Creating Test User 2 (Expired Token)...');
        const user2 = await db.insertInto('users')
            .values({
                id: crypto.randomUUID(),
                email: testEmail2,
                fullName: 'Test Email Verification User 2',
                isEmailVerified: false,
                emailVerificationToken: testToken2,
                emailVerificationExpires: expiresPast,
                updatedAt: new Date(),
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        testUser2Id = user2.id;

        const res3 = await fetch(`${API_BASE_URL}/api/auth/verify-email-link?token=${testToken2}`);
        const data3 = await res3.json();
        console.log(`Status: ${res3.status}`);
        console.log('Response:', data3);

        if (res3.status !== 400 || data3.success !== false || !data3.message.includes('expired')) {
            throw new Error(`Test 3 Failed! Expected 400 with expired message, got ${JSON.stringify(data3)}`);
        }
        console.log('✓ TEST 3 PASSED! Expired verification token rejected.');

        // --- TEST 4: Invalid Token ---
        console.log('\n--- TEST 4: Invalid Verification Token ---');
        const res4 = await fetch(`${API_BASE_URL}/api/auth/verify-email-link?token=non_existent_token_999`);
        const data4 = await res4.json();
        console.log(`Status: ${res4.status}`);
        console.log('Response:', data4);

        if (res4.status !== 400 || data4.success !== false || data4.message !== 'Invalid verification link') {
            throw new Error(`Test 4 Failed! Expected 'Invalid verification link', got ${JSON.stringify(data4)}`);
        }
        console.log('✓ TEST 4 PASSED! Invalid token rejected.');

        // --- TEST 5: Resend Verification Email for Unverified User ---
        console.log('\n--- TEST 5: Resend Verification Email for Unverified User ---');
        const jwtUser2 = generateToken({
            id: user2.id,
            email: user2.email,
            role: 'CLIENT',
        });

        const res5 = await fetch(`${API_BASE_URL}/api/auth/resend-email-verification`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwtUser2}`,
            },
        });
        const data5 = await res5.json();
        console.log(`Status: ${res5.status}`);
        console.log('Response:', data5);

        if (res5.status !== 200 || !data5.success) {
            throw new Error(`Test 5 Failed! Expected success, got ${JSON.stringify(data5)}`);
        }

        // Fetch user 2 from DB to check new token
        const dbUser2Updated = await db.selectFrom('users')
            .select(['emailVerificationToken', 'emailVerificationExpires'])
            .where('id', '=', user2.id)
            .executeTakeFirst();

        if (!dbUser2Updated?.emailVerificationToken) {
            throw new Error('Test 5 Failed! New emailVerificationToken was not generated');
        }
        console.log(`✓ New Token Generated: ${dbUser2Updated.emailVerificationToken}`);

        // Now test verifying with the newly generated token
        const res5b = await fetch(`${API_BASE_URL}/api/auth/verify-email-link?token=${dbUser2Updated.emailVerificationToken}`);
        const data5b = await res5b.json();
        console.log('Verification with new token:', data5b);
        if (!data5b.success) {
            throw new Error('Test 5 Failed! Verification with new token failed');
        }
        console.log('✓ TEST 5 PASSED! Resent verification email token verified successfully.');

        // --- TEST 6: Resend Verification Email for Already Verified User ---
        console.log('\n--- TEST 6: Resend Verification Email for Already Verified User ---');
        const jwtUser1 = generateToken({
            id: user1.id,
            email: user1.email,
            role: 'FREELANCER',
        });

        const res6 = await fetch(`${API_BASE_URL}/api/auth/resend-email-verification`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${jwtUser1}`,
            },
        });
        const data6 = await res6.json();
        console.log(`Status: ${res6.status}`);
        console.log('Response:', data6);

        if (res6.status !== 200 || !data6.success || data6.message !== 'Email is already verified') {
            throw new Error(`Test 6 Failed! Expected 'Email is already verified', got ${JSON.stringify(data6)}`);
        }
        console.log('✓ TEST 6 PASSED! Resend blocked for already verified user.');

        console.log('\n========================================================');
        console.log('  🎉 ALL 6 EMAIL VERIFICATION TESTS PASSED 100%! 🎉');
        console.log('========================================================\n');

    } catch (err) {
        console.error('\n❌ EMAIL VERIFICATION TEST FAILED:', err);
    } finally {
        // --- CLEANUP ---
        console.log('[CLEANUP] Cleaning up test users...');
        if (testUser1Id) {
            await db.deleteFrom('users').where('id', '=', testUser1Id).execute();
        }
        if (testUser2Id) {
            await db.deleteFrom('users').where('id', '=', testUser2Id).execute();
        }
        console.log('✓ Cleanup complete.');
        process.exit(0);
    }
}

runEmailVerificationTests();
