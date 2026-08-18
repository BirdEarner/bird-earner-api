import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { z } from 'zod';
import { validateBody } from '@/lib/validation';

const applyCouponSchema = z.object({
    jobId: z.string().uuid(),
    offerId: z.string().uuid(),
});

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = validateBody(body, applyCouponSchema);
        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { jobId, offerId } = validation.data;

        const client = await db
            .selectFrom('clients')
            .select('id')
            .where('userId', '=', user.id)
            .executeTakeFirst();

        if (!client) {
            return NextResponse.json({ message: 'Client not found' }, { status: 404 });
        }

        const job = await db
            .selectFrom('jobs')
            .select(['id', 'clientId', 'budgetAmount', 'cashbackOfferId'])
            .where('id', '=', jobId)
            .executeTakeFirst();

        if (!job || job.clientId !== client.id) {
            return NextResponse.json({ message: 'Job not found' }, { status: 404 });
        }

        if (job.cashbackOfferId && job.cashbackOfferId !== offerId) {
            await db
                .updateTable('cashbackOffers')
                .set({ reservedJobId: null, updatedAt: new Date() })
                .where('id', '=', job.cashbackOfferId)
                .execute();
        }

        const offer = await db
            .selectFrom('cashbackOffers')
            .selectAll()
            .where('id', '=', offerId)
            .where('clientId', '=', client.id)
            .where('discovered', '=', true)
            .where('used', '=', false)
            .where((eb) => eb.or([
                eb('reservedJobId', 'is', null),
                eb('reservedJobId', '=', jobId),
            ]))
            .executeTakeFirst();

        if (!offer) {
            return NextResponse.json({ message: 'Offer not found or already used.' }, { status: 400 });
        }

        const budgetAmount = parseFloat(job.budgetAmount);
        if (budgetAmount < offer.minBooking) {
            return NextResponse.json({
                message: `Minimum booking of ₹${offer.minBooking} required for this offer. Current budget: ₹${budgetAmount}`
            }, { status: 400 });
        }

        let discountAmount = 0;
        if (offer.amountType === 'LUMPSUM') {
            discountAmount = offer.amount;
        } else {
            discountAmount = Math.min(
                (budgetAmount * offer.amount) / 100,
                offer.maxDiscount || Infinity
            );
        }

        discountAmount = Math.min(discountAmount, budgetAmount);

        await db.transaction().execute(async (trx) => {
            await trx
                .updateTable('jobs')
                .set({
                    cashbackOfferId: offerId,
                    discountAmount: discountAmount.toString(),
                    updatedAt: new Date(),
                })
                .where('id', '=', jobId)
                .execute();

            await trx
                .updateTable('cashbackOffers')
                .set({ reservedJobId: jobId, updatedAt: new Date() })
                .where('id', '=', offerId)
                .execute();

            const clientPays = budgetAmount - discountAmount;

            const clientMsg = `🎁 Coupon applied!\nYou have to pay ₹${clientPays} to freelancer`;
            const freelancerMsg = `🎁 Client applied a coupon!\nClient will pay you ₹${clientPays} in cash and BirdEarner will add ₹${discountAmount} points in your wallet when job completes`;

            const thread = await trx
                .selectFrom('chatThreads')
                .innerJoin('freelancers', 'freelancers.id', 'chatThreads.freelancerId')
                .select([
                    'chatThreads.id as threadId',
                    'freelancers.userId as freelancerUserId',
                ])
                .where('chatThreads.jobId', '=', jobId)
                .where('chatThreads.status', 'in', ['PENDING', 'ACCEPTED'])
                .executeTakeFirst();

            if (thread) {
                await trx.insertInto('messages').values({
                    id: crypto.randomUUID(),
                    chatThreadId: thread.threadId,
                    senderId: user.id,
                    receiverId: user.id,
                    messageContent: clientMsg,
                    messageType: 'notification',
                    senderType: 'SYSTEM',
                    updatedAt: new Date()
                }).execute();

                await trx.insertInto('messages').values({
                    id: crypto.randomUUID(),
                    chatThreadId: thread.threadId,
                    senderId: user.id,
                    receiverId: thread.freelancerUserId,
                    messageContent: freelancerMsg,
                    messageType: 'notification',
                    senderType: 'SYSTEM',
                    updatedAt: new Date()
                }).execute();
            }
        });

        const clientPays = budgetAmount - discountAmount;

        return NextResponse.json({
            success: true,
            message: `You have to pay ₹${clientPays} to freelancer`,
            data: {
                offerId,
                discountAmount,
                clientPays,
                birdEarnerPays: discountAmount,
                minBooking: offer.minBooking,
                amountType: offer.amountType,
                amount: offer.amount,
                maxDiscount: offer.maxDiscount,
            },
        });
    } catch (error: any) {
        console.error('Apply coupon error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
