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
            .selectFrom('chatThreads')
            .selectAll()
            .where('id', '=', chatThreadId)
            .executeTakeFirst();

        if (!thread) {
            return NextResponse.json({ message: 'Chat thread not found' }, { status: 404 });
        }

        const agreedAmount = thread.agreedAmount || thread.freelancerOffer || thread.clientOffer;
        const agreedDays = thread.agreedDays || thread.freelancerDays || thread.clientDays || null;

        const updatedThread = await db
            .updateTable('chatThreads')
            .set({
                isAccepted: true,
                characterLimit: 1000000,
                agreedAmount: agreedAmount?.toString() || null,
                agreedDays: agreedDays,
                status: 'ACCEPTED',
                updatedAt: new Date()
            })
            .where('id', '=', chatThreadId)
            .returningAll()
            .executeTakeFirstOrThrow();

        await db.insertInto('negotiationHistory').values({
            id: crypto.randomUUID(),
            chatThreadId: chatThreadId,
            jobId: thread.jobId,
            senderId: user.id,
            senderType: user.role || 'CLIENT',
            offerType: 'ACCEPTED',
            amount: agreedAmount?.toString() || '0',
            previousAmount: null,
            days: agreedDays,
            previousDays: null,
            note: 'Negotiation accepted',
            createdAt: new Date(),
        }).execute();

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
