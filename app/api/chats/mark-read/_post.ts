import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const markReadSchema = z.object({
    senderId: z.string(),
    receiverId: z.string(),
    jobId: z.string(),
});

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), markReadSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { senderId, receiverId, jobId } = validation.data;

        await db
            .updateTable('messages')
            .set({ isRead: true, updatedAt: new Date() })
            .where('senderId', '=', senderId)
            .where('receiverId', '=', receiverId)
            .where('jobId', '=', jobId)
            .where('isRead', '=', false)
            .execute();

        return NextResponse.json({
            success: true,
            message: 'Messages marked as read'
        });
    } catch (error: any) {
        console.error('Mark read error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
