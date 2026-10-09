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
            .select(['id', 'userId'])
            .where('userId', '=', user.id)
            .executeTakeFirst();

        if (!client) {
            return NextResponse.json({ message: 'Client not found' }, { status: 404 });
        }

        const job = await db
            .selectFrom('jobs')
            .select(['id', 'clientId', 'budgetAmount', 'negotiatedAmount', 'cashbackOfferId', 'serviceId', 'paymentMethod', 'assignedFreelancerId', 'isAmountReserved', 'discountAmount'])
            .where('id', '=', jobId)
            .where('deleted', '=', false)
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

        // Service-bound admin scratch coupons: reject cross-service use on the backend.
        // Egg coupons have serviceId null and keep applying to any service (unchanged).
        if (offer.serviceId && offer.serviceId !== job.serviceId) {
            return NextResponse.json(
                { message: 'This coupon is only valid for its service.' },
                { status: 400 }
            );
        }

        const acceptedThread = await db
            .selectFrom('chatThreads')
            .select('agreedAmount')
            .where('jobId', '=', jobId)
            .where('status', '=', 'ACCEPTED')
            .orderBy('updatedAt', 'desc')
            .executeTakeFirst();

        const finalAmount = parseFloat(job.negotiatedAmount || acceptedThread?.agreedAmount || job.budgetAmount);
        if (finalAmount < offer.minBooking) {
            return NextResponse.json({
                message: `Minimum booking of ₹${offer.minBooking} required for this offer. Current job amount: ₹${finalAmount}`
            }, { status: 400 });
        }

        let discountAmount = 0;
        if (offer.amountType === 'LUMPSUM') {
            discountAmount = offer.amount;
        } else {
            discountAmount = Math.min(
                (finalAmount * offer.amount) / 100,
                offer.maxDiscount || Infinity
            );
        }

        discountAmount = Math.min(discountAmount, finalAmount);

        // PLATFORM job already assigned (reservation = final - current discount):
        // keep reserved amount in sync with the new discount. Pre-assignment jobs are
        // reconciled at assignment time, so no wallet movement there.
        const oldDiscount = parseFloat(job.discountAmount?.toString() || '0');
        const reserveDiff = job.paymentMethod === 'PLATFORM' && job.isAmountReserved && job.assignedFreelancerId
            ? Number((discountAmount - oldDiscount).toFixed(2))
            : 0;

        if (reserveDiff < 0) {
            // Discount reduced/replaced by a smaller one — more funds must be reserved
            const walletRow = await db
                .selectFrom('clients')
                .select(['wallet', 'reservedAmount'])
                .where('id', '=', client.id)
                .executeTakeFirst();
            const curWallet = parseFloat(walletRow?.wallet || '0');
            const curReserved = parseFloat(walletRow?.reservedAmount || '0');
            const available = Math.max(0, curWallet - curReserved);
            const needed = Number((-reserveDiff).toFixed(2));
            if (available < needed) {
                return NextResponse.json({
                    message: `Insufficient wallet balance. Available: ₹${available.toFixed(2)}, Required: ₹${needed.toFixed(2)} to apply this coupon. Please add funds via Pay Birdearner.`
                }, { status: 400 });
            }
        }

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

            if (reserveDiff !== 0) {
                const walletRow = await trx
                    .selectFrom('clients')
                    .select(['id', 'userId', 'wallet', 'reservedAmount'])
                    .where('id', '=', client.id)
                    .executeTakeFirst();

                if (walletRow) {
                    const curWallet = parseFloat(walletRow.wallet || '0');
                    const curReserved = parseFloat(walletRow.reservedAmount || '0');
                    const newReserved = Math.max(0, Number((curReserved - reserveDiff).toFixed(2)));
                    const newAvailable = Math.max(0, curWallet - newReserved);

                    await trx
                        .updateTable('clients')
                        .set({
                            reservedAmount: newReserved.toString(),
                            availableBalance: newAvailable.toString(),
                            updatedAt: new Date(),
                        })
                        .where('id', '=', client.id)
                        .execute();

                    await trx.insertInto('walletTransactions').values({
                        id: crypto.randomUUID(),
                        userId: walletRow.userId,
                        userType: 'CLIENT',
                        jobId,
                        transactionType: reserveDiff > 0 ? 'JOB_RELEASE' : 'JOB_RESERVE',
                        amount: Math.abs(reserveDiff).toString(),
                        balanceBefore: curWallet.toString(),
                        balanceAfter: curWallet.toString(),
                        description: reserveDiff > 0
                            ? `Released reserved amount for coupon applied to job`
                            : `Additional amount reserved for coupon change on job`,
                        updatedAt: new Date()
                    }).execute();
                }
            }

            const clientPays = finalAmount - discountAmount;

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

        const clientPays = finalAmount - discountAmount;

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
