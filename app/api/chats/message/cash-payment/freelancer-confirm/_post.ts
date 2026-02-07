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

            const messageData = JSON.parse(message.messageData as string || '{}');
            if (!messageData.clientConfirmed) {
                throw new Error('Client must confirm payment first');
            }

            messageData.freelancerConfirmed = true;
            messageData.step = 'completed';

            await trx
                .updateTable('messages')
                .set({ messageData: JSON.stringify(messageData), updatedAt: new Date() })
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
            const newBalance = currentBalance - birdFeeAmount;

            await trx
                .updateTable('freelancers')
                .set({ withdrawableAmount: newBalance.toString(), updatedAt: new Date() })
                .where('id', '=', thread.freelancerId)
                .execute();

            // Create wallet transaction record
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

            // System notification message
            await trx
                .insertInto('messages')
                .values({
                    id: crypto.randomUUID(),
                    chatThreadId: threadId,
                    senderId: user.id,
                    receiverId: message.receiverId === user.id ? message.senderId : message.receiverId,
                    messageContent: `✅ Payment completed! Freelancer received ₹${thread.budgetAmount}`,
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
                    messageData: JSON.stringify({
                        jobId: thread.jobId,
                        freelancerId: thread.freelancerId,
                        clientId: message.senderId
                    }),
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
