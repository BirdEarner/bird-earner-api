import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const acceptSchema = z.object({
    chatThreadId: z.string(),
});

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), acceptSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { chatThreadId } = validation.data;

        const thread = await db
            .updateTable('chatThreads')
            .set({ isAccepted: true, characterLimit: 1000000, updatedAt: new Date() })
            .where('id', '=', chatThreadId)
            .returningAll()
            .executeTakeFirstOrThrow();

        return NextResponse.json({
            success: true,
            data: thread
        });
    } catch (error: any) {
        console.error('Accept chat error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
