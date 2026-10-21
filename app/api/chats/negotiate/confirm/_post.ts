import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';
import { getOfferConfirmationState } from '@/lib/services/offerConfirmation';

const confirmSchema = z.object({
    threadId: z.string(),
    // The offer the user is looking at; must match the latest offer on the server
    amount: z.union([z.number().positive(), z.string()]),
    days: z.union([z.number().positive(), z.string()]).optional(),
});

class ConfirmError extends Error {
    constructor(message: string, public status: number, public code?: string) {
        super(message);
    }
}

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), confirmSchema);
        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { threadId, amount, days } = validation.data;
        const requestedAmount = parseFloat(amount.toString());
        const requestedDays = days !== undefined ? parseInt(days.toString(), 10) : null;

        // Locks the thread row, so a confirmation and an offer update on the same thread cannot interleave
        const result = await db.transaction().execute(async (trx) => {
            const thread = await trx
                .selectFrom('chatThreads')
                .selectAll()
                .where('id', '=', threadId)
                .forUpdate()
                .executeTakeFirst();
            if (!thread) throw new ConfirmError('Chat thread not found', 404);

            const [threadClient, threadFreelancer] = await Promise.all([
                trx.selectFrom('clients').select('userId').where('id', '=', thread.clientId).executeTakeFirst(),
                thread.freelancerId
                    ? trx.selectFrom('freelancers').select('userId').where('id', '=', thread.freelancerId).executeTakeFirst()
                    : Promise.resolve(undefined),
            ]);
            const role = user.id === threadClient?.userId ? 'CLIENT' : user.id === threadFreelancer?.userId ? 'FREELANCER' : null;
            if (!role) throw new ConfirmError('You are not a party to this chat', 403);

            if (thread.isAccepted || thread.status === 'ACCEPTED') {
                throw new ConfirmError('This negotiation is already locked.', 400);
            }

            const state = await getOfferConfirmationState(trx, threadId);
            if (!state.latest) throw new ConfirmError('There is no offer to confirm yet.', 400);

            // Only the latest offer can be confirmed. A stale screen gets a mismatch instead.
            const latestAmount = parseFloat(state.latest.amount.toString());
            const latestDays = state.latest.days ?? null;
            const amountMatches = !isNaN(requestedAmount) && requestedAmount === latestAmount;
            const daysMatch = requestedDays === null || requestedDays === latestDays;
            if (!amountMatches || !daysMatch) {
                throw new ConfirmError('Offer mismatch. Please review the latest offer and negotiate again.', 409, 'OFFER_MISMATCH');
            }

            // The party that made the latest offer waits for the other party to accept it
            if (state.latest.senderType === role) {
                throw new ConfirmError('You made the last offer. Wait for the other party to accept it.', 400);
            }

            const alreadyConfirmed = role === 'CLIENT' ? state.clientConfirmed : state.freelancerConfirmed;
            if (!alreadyConfirmed) {
                // Accepting copies the offer into this party's own amount and duration, which then stay locked
                const acceptedPayload: any = { updatedAt: new Date() };
                if (role === 'CLIENT') {
                    acceptedPayload.clientOffer = latestAmount.toString();
                    acceptedPayload.clientDays = latestDays;
                } else {
                    acceptedPayload.freelancerOffer = latestAmount.toString();
                    acceptedPayload.freelancerDays = latestDays;
                }
                await trx.updateTable('chatThreads').set(acceptedPayload).where('id', '=', threadId).execute();

                await trx.insertInto('negotiationHistory').values({
                    id: crypto.randomUUID(),
                    chatThreadId: threadId,
                    jobId: thread.jobId,
                    senderId: user.id,
                    senderType: role,
                    offerType: 'CONFIRM',
                    amount: state.latest.amount.toString(),
                    previousAmount: null,
                    days: latestDays,
                    previousDays: null,
                    note: 'Offer confirmed',
                    createdAt: new Date(),
                }).execute();

                // Tell the party who made the offer that it was accepted
                const daysText = latestDays ? ` in ${latestDays} day${latestDays > 1 ? 's' : ''}` : '';
                const acceptedText = role === 'FREELANCER'
                    ? `The freelancer has accepted your offer and is ready to work for ₹${latestAmount}${daysText}.`
                    : `The client has accepted your offer. You can complete the job for ₹${latestAmount}${daysText}.`;
                const otherUserId = role === 'CLIENT' ? threadFreelancer?.userId : threadClient?.userId;
                await trx.insertInto('messages').values({
                    id: crypto.randomUUID(),
                    chatThreadId: threadId,
                    jobId: thread.jobId,
                    senderId: user.id,
                    receiverId: otherUserId || thread.clientId,
                    senderType: role,
                    messageContent: acceptedText,
                    messageType: 'text',
                    isRead: false,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                }).execute();
            }

            const updated = await getOfferConfirmationState(trx, threadId);
            return { alreadyConfirmed, latestAmount, latestDays, updated };
        });

        return NextResponse.json({
            success: true,
            message: result.alreadyConfirmed ? 'You have already confirmed this offer.' : 'Offer confirmed',
            data: {
                amount: result.latestAmount,
                days: result.latestDays,
                clientConfirmed: result.updated.clientConfirmed,
                freelancerConfirmed: result.updated.freelancerConfirmed,
                ready: result.updated.ready,
            },
        });
    } catch (error: any) {
        if (error instanceof ConfirmError) {
            return NextResponse.json({
                success: false,
                ...(error.code ? { code: error.code } : {}),
                message: error.message,
            }, { status: error.status });
        }
        console.error('Confirm offer error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Failed to confirm offer',
        }, { status: 500 });
    }
}
