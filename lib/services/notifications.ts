import { db } from '../db';

/**
 * Send a notification to a specific user (currently only persists to database)
 */
export async function sendNotification(
    userId: string,
    userType: 'CLIENT' | 'FREELANCER' | 'USER',
    title: string,
    body: string,
    type: string,
    data: any = {}
) {
    try {
        console.log(`Preparing to send notification to user: ${userId}`);

        // 1. Persist notification to database
        const notification = await db
            .insertInto('notifications')
            .values({
                id: crypto.randomUUID(),
                userId,
                userType,
                title,
                message: body,
                type,
                data: JSON.stringify(data || {}),
                isRead: false,
                updatedAt: new Date()
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        console.log(`Notification persisted with ID: ${notification.id}`);

        // NOTE: FCM integration skipped for now as per Next.js API migration scope
        // In a real scenario, we would trigger FCM here if push tokens exist

        return notification;
    } catch (error) {
        console.error('Error in sendNotification:', error);
        // Don't throw to avoid breaking main business logic
        return null;
    }
}
