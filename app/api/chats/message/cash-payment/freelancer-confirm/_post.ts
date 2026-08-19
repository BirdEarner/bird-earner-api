import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { calculateBirdFee } from '@/lib/utils/fee';
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

            let messageData: any = {};
            try {
                if (typeof message.messageData === 'string') {
                    messageData = JSON.parse(message.messageData || '{}');
                } else if (message.messageData == null) {
                    messageData = {};
                } else {
                    messageData = message.messageData;
                }
            } catch (parseError) {
                throw new Error('Invalid message data');
            }

            if (!messageData.clientConfirmed) {
                throw new Error('Client must confirm payment first');
            }

            messageData.freelancerConfirmed = true;
            messageData.step = 'completed';

            await trx
                .updateTable('messages')
                .set({ messageData: messageData, updatedAt: new Date() })
                .where('id', '=', messageId)
                .execute();

            // Complete the job and process platform fee
            const thread = await trx
                .selectFrom('chatThreads')
                .innerJoin('jobs', 'jobs.id', 'chatThreads.jobId')
                .innerJoin('freelancers', 'freelancers.id', 'chatThreads.freelancerId')
                .leftJoin('services', 'services.id', 'jobs.serviceId')
                .select([
                    'jobs.id as jobId',
                    'jobs.jobTitle',
                    'jobs.budgetAmount',
                    'jobs.discountAmount',
                    'jobs.cashbackOfferId',
                    'jobs.clientPenaltyAmount',
                    'freelancers.id as freelancerId',
                    'freelancers.userId as freelancerUserId',
                    'freelancers.withdrawableAmount',
                    'services.birdFee'
                ])
                .where('chatThreads.id', '=', threadId)
                .executeTakeFirst();

            if (!thread) throw new Error('Thread/Job not found');

            let birdFeeAmount = 0;
            if (thread.birdFee) {
                birdFeeAmount = calculateBirdFee(parseFloat(thread.budgetAmount), thread.birdFee);
            } else {
                birdFeeAmount = parseFloat(thread.budgetAmount) * 0.10;
            }

            // Update job status
            await trx
                .updateTable('jobs')
                .set({
                    jobStatus: 'COMPLETED',
                    paymentStatus: 'COMPLETED',
                    birdFeeAmount: birdFeeAmount.toString(),
                    updatedAt: new Date()
                })
                .where('id', '=', thread.jobId)
                .execute();

            // Deduct bird fee from freelancer's wallet (ALLOW NEGATIVE)
            const currentBalance = parseFloat(thread.withdrawableAmount);
            const discountAmt = parseFloat(thread.discountAmount || '0');
            const penaltyAmt = parseFloat(thread.clientPenaltyAmount?.toString() || '0');
            let newBalance = currentBalance - birdFeeAmount;

            await trx
                .updateTable('freelancers')
                .set({ withdrawableAmount: newBalance.toString(), updatedAt: new Date() })
                .where('id', '=', thread.freelancerId)
                .execute();

            // Create wallet transaction record for platform fee
            await trx
                .insertInto('walletTransactions')
                .values({
                    id: crypto.randomUUID(),
                    userId: thread.freelancerUserId,
                    userType: 'FREELANCER',
                    jobId: thread.jobId,
                    amount: (-birdFeeAmount).toString(),
                    transactionType: 'PLATFORM_FEE',
                    balanceBefore: currentBalance.toString(),
                    balanceAfter: newBalance.toString(),
                    description: `Platform fee for job completion (Cash Payment) - ${thread.jobTitle}`,
                    updatedAt: new Date()
                })
                .execute();

            // Deduct client cancellation penalty from freelancer's wallet
            if (penaltyAmt > 0) {
                const balanceBeforePenalty = newBalance;
                newBalance = newBalance - penaltyAmt;

                await trx
                    .updateTable('freelancers')
                    .set({ withdrawableAmount: newBalance.toString(), updatedAt: new Date() })
                    .where('id', '=', thread.freelancerId)
                    .execute();

                await trx
                    .insertInto('walletTransactions')
                    .values({
                        id: crypto.randomUUID(),
                        userId: thread.freelancerUserId,
                        userType: 'FREELANCER',
                        jobId: thread.jobId,
                        amount: (-penaltyAmt).toString(),
                        transactionType: 'PLATFORM_FEE',
                        balanceBefore: balanceBeforePenalty.toString(),
                        balanceAfter: newBalance.toString(),
                        description: `Client cancellation penalty deducted - ${thread.jobTitle}`,
                        updatedAt: new Date()
                    })
                    .execute();
            }

            // Credit cashback discount from BirdEarner to freelancer
            if (discountAmt > 0) {
                const balanceBeforeCashback = newBalance;
                newBalance = newBalance + discountAmt;

                await trx
                    .updateTable('freelancers')
                    .set({ withdrawableAmount: newBalance.toString(), updatedAt: new Date() })
                    .where('id', '=', thread.freelancerId)
                    .execute();

                await trx
                    .insertInto('walletTransactions')
                    .values({
                        id: crypto.randomUUID(),
                        userId: thread.freelancerUserId,
                        userType: 'FREELANCER',
                        jobId: thread.jobId,
                        amount: discountAmt.toString(),
                        transactionType: 'DEPOSIT',
                        balanceBefore: balanceBeforeCashback.toString(),
                        balanceAfter: newBalance.toString(),
                        description: `Cashback coupon applied by client - ${thread.jobTitle}`,
                        updatedAt: new Date()
                    })
                    .execute();
            }

            // Mark coupon as fully used after job completion (outside discount check)
            if (thread.cashbackOfferId) {
                await trx
                    .updateTable('cashbackOffers')
                    .set({ used: true, reservedJobId: null, updatedAt: new Date() })
                    .where('id', '=', thread.cashbackOfferId)
                    .execute();
            }

            // System notification message
            const budgetAmt = parseFloat(thread.budgetAmount);
            const clientPays = budgetAmt - discountAmt;
            let notificationText = `✅ Payment completed!`;
            if (discountAmt > 0) {
                notificationText += `\n💰 Client paid: ₹${clientPays}`;
                notificationText += `\n🎁 BirdEarner paid: ₹${discountAmt} (cashback)`;
                notificationText += `\nTotal to freelancer: ₹${budgetAmt}`;
            } else {
                notificationText += ` Freelancer received ₹${budgetAmt}`;
            }

            await trx
                .insertInto('messages')
                .values({
                    id: crypto.randomUUID(),
                    chatThreadId: threadId,
                    senderId: user.id,
                    receiverId: message.receiverId === user.id ? message.senderId : message.receiverId,
                    messageContent: notificationText,
                    messageType: 'notification',
                    senderType: 'SYSTEM',
                    updatedAt: new Date()
                })
                .execute();

            // Review request
            await trx
                .insertInto('messages')
                .values({
                    id: crypto.randomUUID(),
                    chatThreadId: threadId,
                    senderId: thread.freelancerUserId,
                    receiverId: message.senderId, // Assuming client
                    messageContent: JSON.stringify({ status: 'pending' }),
                    messageType: 'review_request',
                    senderType: 'SYSTEM',
                    messageData: {
                        jobId: thread.jobId,
                        freelancerId: thread.freelancerId,
                        clientId: message.senderId
                    },
                    updatedAt: new Date()
                })
                .execute();
        });

        return NextResponse.json({
            success: true,
            message: 'Payment process completed successfully'
        });
    } catch (error: any) {
        console.error('Freelancer confirm error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
