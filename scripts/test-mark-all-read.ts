import 'dotenv/config';
import { db } from '../lib/db';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';

async function testMarkAllRead() {
    console.log('--- TESTING MARK ALL NOTIFICATIONS AS READ ---');

    // 1. Get a test user from DB
    const testUser = await db
        .selectFrom('users')
        .select(['id', 'email'])
        .executeTakeFirst();

    if (!testUser) {
        console.error('No test user found in database!');
        process.exit(1);
    }

    console.log(`[SETUP] Test User ID: ${testUser.id}, Email: ${testUser.email}`);

    // 2. Create sample unread notifications if none exist
    const unreadBefore = await db
        .selectFrom('notifications')
        .select(({ fn }) => fn.count('id').as('count'))
        .where('userId', '=', testUser.id)
        .where('isRead', '=', false)
        .executeTakeFirst();

    let initialUnreadCount = Number(unreadBefore?.count || 0);
    console.log(`[SETUP] Unread notifications before test: ${initialUnreadCount}`);

    if (initialUnreadCount === 0) {
        console.log('[SETUP] Creating dummy unread notification for test...');
        await db
            .insertInto('notifications')
            .values({
                id: `test_notif_${Date.now()}`,
                userId: testUser.id,
                title: 'Test Notification',
                message: 'This is a test notification for mark all as read.',
                type: 'SYSTEM',
                userType: 'CLIENT',
                isRead: false,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .execute();
        initialUnreadCount = 1;
    }

    // 3. Generate Auth JWT Token
    const JWT_SECRET = process.env.JWT_SECRET || 'bird_earner_jwt_secret_key_make_it_long_and_secure_for_production_use';
    const token = jwt.sign(
        { id: testUser.id, email: testUser.email, role: 'CLIENT' },
        JWT_SECRET,
        { expiresIn: '1h' }
    );

    // 4. Call PUT /api/notifications/[id]/read-all
    const PORT = process.env.PORT || '3001';
    const apiUrl = `http://localhost:${PORT}/api/notifications/${testUser.id}/read-all`;
    console.log(`[CALL API] PUT ${apiUrl}`);

    const res = await fetch(apiUrl, {
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });

    console.log(`[API RESPONSE] Status: ${res.status}`);
    const jsonResult: any = await res.json();
    console.log(`[API RESPONSE] Body:`, jsonResult);

    // 5. Verify in DB that unread count is now 0
    const unreadAfter = await db
        .selectFrom('notifications')
        .select(({ fn }) => fn.count('id').as('count'))
        .where('userId', '=', testUser.id)
        .where('isRead', '=', false)
        .executeTakeFirst();

    const finalUnreadCount = Number(unreadAfter?.count || 0);
    console.log(`[VERIFY DB] Unread notifications after mark-all-read: ${finalUnreadCount}`);

    if (res.ok && finalUnreadCount === 0) {
        console.log('🎉 MARK ALL NOTIFICATIONS AS READ IS 100% WORKING! 🎉');
    } else {
        console.error('❌ Mark all notifications read test FAILED!');
        process.exit(1);
    }

    process.exit(0);
}

testMarkAllRead().catch((err) => {
    console.error('Test error:', err);
    process.exit(1);
});
