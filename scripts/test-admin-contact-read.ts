import 'dotenv/config';
import { db } from '../lib/db';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';

async function testAdminContactRead() {
    console.log('--- TESTING ADMIN CONTACT MARK READ & RESOLVE ---');

    // 1. Get an admin or user to test with
    const testAdmin = await db
        .selectFrom('admins')
        .select(['id', 'email', 'role'])
        .executeTakeFirst();

    if (!testAdmin) {
        console.error('No admin user found in database!');
        process.exit(1);
    }

    console.log(`[SETUP] Test Admin ID: ${testAdmin.id}, Email: ${testAdmin.email}`);

    // 2. Get a pending contact ticket
    const pendingContact = await db
        .selectFrom('contacts')
        .select(['id', 'ticketId', 'status'])
        .where('status', '=', 'pending')
        .executeTakeFirst();

    if (!pendingContact) {
        console.error('No pending contact found in database!');
        process.exit(1);
    }

    console.log(`[SETUP] Found Pending Contact ID: ${pendingContact.id}, Ticket: ${pendingContact.ticketId}`);

    // 3. Generate Auth JWT Token for Admin
    const JWT_SECRET = process.env.JWT_SECRET || 'bird_earner_jwt_secret_key_make_it_long_and_secure_for_production_use';
    const token = jwt.sign(
        { id: testAdmin.id, email: testAdmin.email, role: testAdmin.role || 'SUPER_ADMIN', isAdmin: true },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    // 4. Call PATCH /api/admin/contacts/[id]/read
    const PORT = process.env.PORT || '3001';
    const apiUrl = `http://localhost:${PORT}/api/admin/contacts/${pendingContact.id}/read`;
    console.log(`[CALL API] PATCH ${apiUrl}`);

    const res = await fetch(apiUrl, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });

    console.log(`[API RESPONSE] Status: ${res.status}`);
    const jsonResult: any = await res.json();
    console.log(`[API RESPONSE] Body:`, jsonResult);

    // 5. Verify status in DB
    const updatedContact = await db
        .selectFrom('contacts')
        .select(['id', 'status', 'isRead'])
        .where('id', '=', pendingContact.id)
        .executeTakeFirst();

    console.log(`[VERIFY DB] Contact status after update: ${updatedContact?.status}, isRead: ${updatedContact?.isRead}`);

    if (res.ok && updatedContact?.status === 'resolved' && updatedContact?.isRead === true) {
        console.log('🎉 ADMIN CONTACT MARK READ & RESOLVE TEST 100% PASSED! 🎉');
        process.exit(0);
    } else {
        console.error('❌ Admin contact mark read test FAILED!');
        process.exit(1);
    }
}

testAdminContactRead().catch((err) => {
    console.error('Test error:', err);
    process.exit(1);
});
