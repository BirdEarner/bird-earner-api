import 'dotenv/config';
import { db } from '../lib/db';
import { POST as clientSignupHandler } from '../app/api/signup/client/_post';
import { GET as verifyEmailLinkHandler } from '../app/api/auth/verify-email-link/route';

async function runSignupEmailVerificationFlowTest() {
    console.log('\n========================================================');
    console.log('  TESTING SIGNUP -> EMAIL VERIFICATION FLOW');
    console.log('========================================================\n');

    const testMobile = `+9199${Math.floor(10000000 + Math.random() * 90000000)}`;
    const testEmail = `signup_flow_test_${Date.now()}@example.com`;
    const testPassword = 'TestPassword123!';

    let createdUserId: string | null = null;
    let createdClientId: string | null = null;

    try {
        // --- STEP 1: Verify Mobile Number in otpVerifications ---
        console.log(`[STEP 1] Creating verified OTP record for mobile: ${testMobile}...`);
        await db.insertInto('otpVerifications')
            .values({
                id: crypto.randomUUID(),
                mobile: testMobile,
                code: '123456',
                verified: true,
                expiresAt: new Date(Date.now() + 600000),
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .execute();
        console.log('✓ OTP record verified in DB.');

        // --- STEP 2: Perform Client Signup via Direct Handler ---
        console.log(`\n[STEP 2] Executing Client Signup Handler for ${testEmail}...`);
        const signupPayload = {
            email: testEmail,
            password: testPassword,
            full_name: 'Email Verification Tester',
            mobile: testMobile,
            termsAccepted: true,
        };

        const signupReq = new Request('http://localhost:3000/api/signup/client', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(signupPayload),
        });

        const signupRes = await clientSignupHandler(signupReq);
        const signupJson = await signupRes.json();
        console.log(`HTTP Status: ${signupRes.status}`);
        console.log('Signup Response:', signupJson);

        if (signupRes.status !== 201 || !signupJson.success) {
            throw new Error(`Signup Failed! Expected 201 Created, got ${JSON.stringify(signupJson)}`);
        }

        createdUserId = signupJson.data.id;
        createdClientId = signupJson.data.client?.id;
        console.log(`✓ User registered successfully! User ID: ${createdUserId}`);

        // --- STEP 3: Verify Initial Unverified DB State ---
        console.log('\n[STEP 3] Checking User status in Database after Signup...');
        const userInDb = await db.selectFrom('users')
            .select(['id', 'email', 'isEmailVerified', 'emailVerificationToken'])
            .where('id', '=', createdUserId!)
            .executeTakeFirst();

        console.log('Database User State:', userInDb);

        if (!userInDb) {
            throw new Error('User not found in DB!');
        }

        if (userInDb.isEmailVerified !== false) {
            throw new Error(`Expected isEmailVerified = false on signup, but got ${userInDb.isEmailVerified}`);
        }

        if (!userInDb.emailVerificationToken) {
            throw new Error('emailVerificationToken was not set on signup!');
        }

        const verificationToken = userInDb.emailVerificationToken;
        console.log(`✓ Confirmed: User is initially UNVERIFIED (isEmailVerified = false).`);
        console.log(`✓ Generated Verification Token: ${verificationToken}`);

        // --- STEP 4: Trigger Email Verification Link Endpoint ---
        console.log(`\n[STEP 4] Simulating User clicking verification link (/api/auth/verify-email-link?token=${verificationToken})...`);
        const verifyReq = new Request(`http://localhost:3000/api/auth/verify-email-link?token=${verificationToken}`);
        const verifyRes = await verifyEmailLinkHandler(verifyReq);
        const verifyJson = await verifyRes.json();

        console.log(`HTTP Status: ${verifyRes.status}`);
        console.log('Verification Response:', verifyJson);

        if (verifyRes.status !== 200 || !verifyJson.success || verifyJson.message !== 'Email verified successfully') {
            throw new Error(`Verification endpoint failed! Got ${JSON.stringify(verifyJson)}`);
        }
        console.log('✓ Verification API returned success!');

        // --- STEP 5: Verify Final Verified DB State ---
        console.log('\n[STEP 5] Checking User status in Database after Email Verification...');
        const verifiedUserInDb = await db.selectFrom('users')
            .select(['id', 'email', 'isEmailVerified'])
            .where('id', '=', createdUserId!)
            .executeTakeFirst();

        console.log('Database User State Post-Verification:', verifiedUserInDb);

        if (!verifiedUserInDb?.isEmailVerified) {
            throw new Error('User is STILL unverified in DB after calling verification link!');
        }
        console.log('✓ Confirmed: User is now VERIFIED in Database (isEmailVerified = true)!');

        console.log('\n========================================================');
        console.log('  🎉 SIGNUP -> EMAIL VERIFICATION FLOW PASSED 100%! 🎉');
        console.log('========================================================\n');

    } catch (err) {
        console.error('\n❌ SIGNUP EMAIL VERIFICATION FLOW TEST FAILED:', err);
    } finally {
        // --- CLEANUP ---
        console.log('[CLEANUP] Cleaning up test user & client records...');
        if (createdClientId) {
            await db.deleteFrom('clients').where('id', '=', createdClientId).execute();
        }
        if (createdUserId) {
            await db.deleteFrom('users').where('id', '=', createdUserId).execute();
        }
        await db.deleteFrom('otpVerifications').where('mobile', '=', testMobile).execute();
        console.log('✓ Cleanup complete.');
        process.exit(0);
    }
}

runSignupEmailVerificationFlowTest();
