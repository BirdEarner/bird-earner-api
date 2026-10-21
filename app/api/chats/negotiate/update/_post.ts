import { db } from '@/lib/db';
import { sql } from 'kysely';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';
import { getOfferConfirmationState } from '@/lib/services/offerConfirmation';

const updateOfferSchema = z.object({
    threadId: z.string(),
    amount: z.union([z.number().positive(), z.string()]),
    days: z.union([z.number().positive(), z.string()]).optional(),
    userRole: z.string(),
});

class OfferError extends Error {
    constructor(message: string, public status: number) {
        super(message);
    }
}

export async function POST(request: Request) {
    try {
        await sql`
            ALTER TABLE "chatThreads"
            ADD COLUMN IF NOT EXISTS "clientOffer" DECIMAL(10,2),
            ADD COLUMN IF NOT EXISTS "freelancerOffer" DECIMAL(10,2),
            ADD COLUMN IF NOT EXISTS "agreedAmount" DECIMAL(10,2),
            ADD COLUMN IF NOT EXISTS "clientDays" INTEGER,
            ADD COLUMN IF NOT EXISTS "freelancerDays" INTEGER,
            ADD COLUMN IF NOT EXISTS "agreedDays" INTEGER;
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

        const { threadId, amount, days } = validation.data;
        const parsedAmount = parseFloat(amount.toString());

        if (isNaN(parsedAmount) || parsedAmount <= 0) {
            return NextResponse.json({ success: false, message: 'Invalid offer amount' }, { status: 400 });
        }

        const amountStr = parsedAmount.toString();
        const parsedDays = days ? parseInt(days.toString(), 10) : null;
        if (parsedDays !== null && (isNaN(parsedDays) || parsedDays <= 0)) {
            return NextResponse.json({ success: false, message: 'Invalid days value' }, { status: 400 });
        }

        // The whole update runs in one transaction that locks the thread row, so offers and
        // confirmations on the same thread happen one after another and never interleave
        const result = await db.transaction().execute(async (trx) => {
            const thread = await trx
                .selectFrom('chatThreads')
                .selectAll()
                .where('id', '=', threadId)
                .forUpdate()
                .executeTakeFirst();

            if (!thread) throw new OfferError('Chat thread not found', 404);

            // The caller's side comes from their account on this thread, never from the request body
            const [threadClient, threadFreelancer] = await Promise.all([
                trx.selectFrom('clients').select('userId').where('id', '=', thread.clientId).executeTakeFirst(),
                thread.freelancerId
                    ? trx.selectFrom('freelancers').select('userId').where('id', '=', thread.freelancerId).executeTakeFirst()
                    : Promise.resolve(undefined),
            ]);
            const normalizedRole = user.id === threadClient?.userId ? 'CLIENT' : user.id === threadFreelancer?.userId ? 'FREELANCER' : null;
            if (!normalizedRole) throw new OfferError('You are not a party to this chat', 403);

            if (thread.status === 'ACCEPTED' || thread.isAccepted) {
                throw new OfferError('Negotiation is locked because the job proposal has already been accepted.', 400);
            }

            // Offer rules: while an offer is pending the party who made it cannot change it,
            // and once the other party has accepted, neither side can change the agreed offer
            const state = await getOfferConfirmationState(trx, threadId);
            if (state.ready) {
                throw new OfferError('The offer has been accepted and is locked.', 409);
            }
            if (state.latest) {
                if (state.latest.senderType === normalizedRole) {
                    throw new OfferError('Waiting for the other party to respond to your offer. You can change it after they respond.', 409);
                }
                const mySideConfirmed = normalizedRole === 'CLIENT' ? state.clientConfirmed : state.freelancerConfirmed;
                if (mySideConfirmed) {
                    throw new OfferError('You have accepted this offer. Your amount and duration are locked.', 409);
                }
            }

            const isClient = normalizedRole === 'CLIENT';
            const previousAmount = isClient ? thread.clientOffer : thread.freelancerOffer;
            const previousDays = isClient ? thread.clientDays : thread.freelancerDays;

            const updatePayload: any = { updatedAt: new Date() };
            if (isClient) {
                updatePayload.clientOffer = amountStr;
                if (parsedDays !== null) updatePayload.clientDays = parsedDays;
            } else {
                updatePayload.freelancerOffer = amountStr;
                if (parsedDays !== null) updatePayload.freelancerDays = parsedDays;
            }

            const updatedThread = await trx
                .updateTable('chatThreads')
                .set(updatePayload)
                .where('id', '=', threadId)
                .returningAll()
                .executeTakeFirstOrThrow();

            await trx.insertInto('negotiationHistory').values({
                id: crypto.randomUUID(),
                chatThreadId: threadId,
                jobId: thread.jobId,
                senderId: user.id,
                senderType: normalizedRole,
                offerType: 'OFFER',
                amount: amountStr,
                previousAmount: previousAmount?.toString() || null,
                days: parsedDays,
                previousDays: previousDays || null,
                note: null,
                createdAt: new Date(),
            }).execute();

            // Notify the other party with a chat message
            const receiverUserId = isClient ? threadFreelancer?.userId : threadClient?.userId;
            const senderText = isClient ? 'Client' : 'Freelancer';
            let offerMessage = `${senderText} updated offer to ₹${amountStr}`;
            if (parsedDays !== null) {
                offerMessage += ` with ${parsedDays} day${parsedDays > 1 ? 's' : ''} deadline`;
            }
            await trx.insertInto('messages').values({
                id: crypto.randomUUID(),
                chatThreadId: threadId,
                jobId: thread.jobId,
                senderId: user.id,
                receiverId: receiverUserId || thread.clientId,
                senderType: normalizedRole,
                messageContent: offerMessage,
                messageType: 'text',
                isRead: false,
                createdAt: new Date(),
                updatedAt: new Date(),
            }).execute();

            return updatedThread;
        });

        return NextResponse.json({
            success: true,
            message: 'Offer updated successfully',
            data: {
                ...result,
                storageLimit: result.storageLimit?.toString(),
                usedStorage: result.usedStorage?.toString(),
            }
        });
    } catch (error: any) {
        if (error instanceof OfferError) {
            return NextResponse.json({ success: false, message: error.message }, { status: error.status });
        }
        console.error('Update offer error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Failed to update offer'
        }, { status: 500 });
    }
}
