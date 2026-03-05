import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

const createNotificationSchema = z.object({
    title: z.string().min(1),
    message: z.string().min(1),
    type: z.string().default('system'),
    targetType: z.enum(['specific', 'all_clients', 'all_freelancers']),
    targetUserId: z.string().optional(),
    targetUserType: z.string().optional(), // 'client' or 'freelancer'
    scheduledAt: z.string().optional().nullable(),
});

export async function POST(request: Request) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        }

        const body = await request.json();
        const validation = createNotificationSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error.errors }, { status: 400 });
        }

        const { title, message, type, targetType, targetUserId, targetUserType, scheduledAt } = validation.data;
        const status = scheduledAt ? 'SCHEDULED' : 'SENT';
        const scheduledDate = scheduledAt ? new Date(scheduledAt) : null;

        let recipients: { userId: string; userType: string }[] = [];

        if (targetType === 'specific') {
            if (!targetUserId || !targetUserType) {
                return NextResponse.json({ message: 'Target user ID and type are required for specific targeting' }, { status: 400 });
            }
            recipients.push({ userId: targetUserId, userType: targetUserType });
        } else if (targetType === 'all_clients') {
            const clients = await db.selectFrom('clients').select('userId').execute();
            recipients = clients.map(c => ({ userId: c.userId, userType: 'client' }));
        } else if (targetType === 'all_freelancers') {
            const freelancers = await db.selectFrom('freelancers').select('userId').execute();
            recipients = freelancers.map(f => ({ userId: f.userId, userType: 'freelancer' }));
        }

        if (recipients.length === 0) {
            return NextResponse.json({ message: 'No recipients found' }, { status: 404 });
        }

        // Chunk inserts if too many
        const CHUNK_SIZE = 500;
        for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
            const chunk = recipients.slice(i, i + CHUNK_SIZE);
            const values = chunk.map(r => ({
                id: uuidv4(),
                userId: r.userId,
                userType: r.userType,
                title,
                message,
                type,
                status,
                scheduledAt: scheduledDate,
                isRead: false,
                updatedAt: new Date()
            }));

            await db.insertInto('notifications').values(values).execute();
        }

        return NextResponse.json({
            success: true,
            message: `Notification created for ${recipients.length} users`
        });

    } catch (error: any) {
        console.error('Create notification error:', error);
        return NextResponse.json({ message: error.message || 'Server error' }, { status: 500 });
    }
}
