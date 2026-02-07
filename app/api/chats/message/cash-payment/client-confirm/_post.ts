import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const confirmSchema = z.object({
    messageId: z.string(),
    threadId: z.string(),
});

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), confirmSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { messageId, threadId } = validation.data;

        await db.transaction().execute(async (trx) => {
            const message = await trx
                .selectFrom('messages')
                .selectAll()
                .where('id', '=', messageId)
                .executeTakeFirst();

            if (!message || message.messageType !== 'cash_payment') {
                throw new Error('Cash payment message not found');
            }

            const messageData = JSON.parse(message.messageData as string || '{}');
            messageData.clientConfirmed = true;

            await trx
                .updateTable('messages')
                .set({ messageData: JSON.stringify(messageData), updatedAt: new Date() })
                .where('id', '=', messageId)
                .execute();

            const displayAmount = messageData.amount?.toString() || '0';

            await trx
                .insertInto('messages')
                .values({
                    id: crypto.randomUUID(),
                    chatThreadId: threadId,
                    senderId: user.id,
                    receiverId: message.receiverId === user.id ? message.senderId : message.receiverId,
                    messageContent: `Client has confirmed cash payment of ₹${displayAmount}`,
                    messageType: 'notification',
                    senderType: 'SYSTEM',
                    updatedAt: new Date()
                })
                .execute();
        });

        return NextResponse.json({
            success: true,
            message: 'Payment confirmation recorded'
        });
    } catch (error: any) {
        console.error('Client confirm error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
