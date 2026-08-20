import { db } from '@/lib/db';
import { sql } from 'kysely';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const updateOfferSchema = z.object({
    threadId: z.string(),
    amount: z.union([z.number().positive(), z.string()]),
    userRole: z.string(),
});

export async function POST(request: Request) {
    try {
        await sql`
            ALTER TABLE "chatThreads" 
            ADD COLUMN IF NOT EXISTS "clientOffer" DECIMAL(10,2),
            ADD COLUMN IF NOT EXISTS "freelancerOffer" DECIMAL(10,2),
            ADD COLUMN IF NOT EXISTS "agreedAmount" DECIMAL(10,2);
        `.execute(db).catch(() => {});
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), updateOfferSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { threadId, amount, userRole } = validation.data;
        const normalizedRole = userRole.toUpperCase();
        const parsedAmount = parseFloat(amount.toString());

        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return NextResponse.json({ success: false, message: 'Invalid offer amount' }, { status: 400 });
        }

        const amountStr = parsedAmount.toString();

        const thread = await db
            .selectFrom('chatThreads')
            .selectAll()
            .where('id', '=', threadId)
            .executeTakeFirst();

        if (!thread) {
            return NextResponse.json({ success: false, message: 'Chat thread not found' }, { status: 404 });
        }

        if (thread.status === 'ACCEPTED' || thread.isAccepted) {
            return NextResponse.json({
                success: false,
                message: 'Negotiation is locked because the job proposal has already been accepted.'
            }, { status: 400 });
        }

        const isClient = normalizedRole === 'CLIENT';
        const previousAmount = isClient ? thread.clientOffer : thread.freelancerOffer;

        const updatedThread = await db
            .updateTable('chatThreads')
            .set(isClient ? { clientOffer: amountStr, updatedAt: new Date() } : { freelancerOffer: amountStr, updatedAt: new Date() })
            .where('id', '=', threadId)
            .returningAll()
            .executeTakeFirstOrThrow();

        await db.insertInto('negotiationHistory').values({
            id: crypto.randomUUID(),
            chatThreadId: threadId,
            jobId: thread.jobId,
            senderId: user.id,
            senderType: normalizedRole,
            offerType: 'OFFER',
            amount: amountStr,
            previousAmount: previousAmount?.toString() || null,
            note: null,
            createdAt: new Date(),
        }).execute();

        // Get receiver user ID
        let receiverUserId = thread.clientId;
        if (isClient) {
            const freelancer = await db.selectFrom('freelancers').select('userId').where('id', '=', thread.freelancerId).executeTakeFirst();
            if (freelancer) receiverUserId = freelancer.userId;
        } else {
            const client = await db.selectFrom('clients').select('userId').where('id', '=', thread.clientId).executeTakeFirst();
            if (client) receiverUserId = client.userId;
        }

        // Create a message in the chat thread notifying of the updated offer
        const senderText = isClient ? 'Client' : 'Freelancer';
        await db.insertInto('messages').values({
            id: crypto.randomUUID(),
            chatThreadId: threadId,
            jobId: thread.jobId,
            senderId: user.id,
            receiverId: receiverUserId,
            senderType: normalizedRole,
            messageContent: `${senderText} updated offer to ₹${amountStr}`,
            messageType: 'text',
            isRead: false,
            updatedAt: new Date(),
        }).execute();

        return NextResponse.json({
            success: true,
            message: 'Offer updated successfully',
            data: {
                ...updatedThread,
                storageLimit: updatedThread.storageLimit?.toString(),
                usedStorage: updatedThread.usedStorage?.toString(),
            }
        });
    } catch (error: any) {
        console.error('Update offer error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Failed to update offer'
        }, { status: 500 });
    }
}
