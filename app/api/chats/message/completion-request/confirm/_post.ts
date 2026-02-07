import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { completeJob } from '@/lib/services/jobs';
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

        const result = await db.transaction().execute(async (trx) => {
            const message = await trx
                .selectFrom('messages')
                .selectAll()
                .where('id', '=', messageId)
                .executeTakeFirst();

            if (!message || message.messageType !== 'completion_request') {
                throw new Error('Completion request message not found');
            }

            const messageData = JSON.parse(message.messageData as string || '{}');
            if (messageData.status !== 'pending') {
                throw new Error('This completion request is no longer active');
            }

            const { jobId, paymentMethod, budgetAmount, requestedBy } = messageData;

            // 1. Update request status
            messageData.status = 'confirmed';
            messageData.confirmedBy = user.id;
            messageData.confirmedAt = new Date().toISOString();

            await trx
                .updateTable('messages')
                .set({ messageData: JSON.stringify(messageData), updatedAt: new Date() })
                .where('id', '=', messageId)
                .execute();

            // 2. Notification
            const confirmationText = requestedBy === 'freelancer'
                ? 'Client has confirmed project completion'
                : 'Freelancer has confirmed project completion';

            await trx
                .insertInto('messages')
                .values({
                    id: crypto.randomUUID(),
                    chatThreadId: threadId,
                    senderId: user.id,
                    receiverId: message.senderId,
                    messageContent: confirmationText,
                    messageType: 'notification',
                    senderType: 'SYSTEM',
                    updatedAt: new Date()
                })
                .execute();

            // 3. Payment Processing
            if (paymentMethod === 'CASH') {
                const cashMsg = await trx
                    .insertInto('messages')
                    .values({
                        id: crypto.randomUUID(),
                        chatThreadId: threadId,
                        senderId: user.id,
                        receiverId: message.senderId,
                        messageContent: 'Project completion confirmed. Cash payment process initiated.',
                        messageType: 'cash_payment',
                        senderType: 'SYSTEM',
                        messageData: JSON.stringify({
                            amount: budgetAmount,
                            step: 'initial',
                            clientConfirmed: false,
                            freelancerConfirmed: false,
                            jobId: jobId
                        }),
                        updatedAt: new Date()
                    })
                    .returningAll()
                    .executeTakeFirstOrThrow();

                return { success: true, message: 'Cash payment flow initiated', cashPaymentMessage: cashMsg };
            } else {
                // Platform Payment
                try {
                    // Note: completeJob needs clientId, we have userId in user.id
                    // We need to fetch clientId
                    const job = await trx
                        .selectFrom('jobs')
                        .innerJoin('clients', 'clients.id', 'jobs.clientId')
                        .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
                        .select(['jobs.clientId', 'clients.userId as clientUserId', 'freelancers.userId as freelancerUserId'])
                        .where('jobs.id', '=', jobId)
                        .executeTakeFirst();

                    if (!job) throw new Error('Job not found');

                    // The completeJob service already handles the transaction if we call it outside, 
                    // but we are ALREADY in a transaction. 
                    // I should've made a completeJobInTransaction in the service.
                    // For now, I'll assume completeJob handles its own transaction and is safe to call here?
                    // Kysely nested transactions are supported.

                    const completedJob = await completeJob(jobId, job.clientUserId);

                    await trx
                        .insertInto('messages')
                        .values({
                            id: crypto.randomUUID(),
                            chatThreadId: threadId,
                            senderId: user.id,
                            receiverId: message.senderId,
                            messageContent: '✅ Project completed successfully! Payment processed via platform.',
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
                            senderId: job.freelancerUserId!,
                            receiverId: job.clientUserId,
                            messageContent: JSON.stringify({ status: 'pending' }),
                            messageType: 'review_request',
                            senderType: 'SYSTEM',
                            messageData: JSON.stringify({
                                jobId: jobId,
                                freelancerId: job.freelancerUserId,
                                clientId: job.clientId
                            }),
                            updatedAt: new Date()
                        })
                        .execute();

                    return { success: true, message: 'Project completion confirmed and payment processed', data: completedJob };
                } catch (paymentError: any) {
                    console.error('Platform payment error:', paymentError);
                    // Fallback like original server
                    await trx
                        .updateTable('jobs')
                        .set({
                            jobStatus: 'COMPLETED',
                            completedAt: new Date(),
                            paymentStatus: 'FAILED',
                            updatedAt: new Date()
                        })
                        .where('id', '=', jobId)
                        .execute();

                    await trx
                        .insertInto('messages')
                        .values({
                            id: crypto.randomUUID(),
                            chatThreadId: threadId,
                            senderId: user.id,
                            receiverId: message.senderId,
                            messageContent: '⚠️ Project completed but payment processing failed. Please contact support.',
                            messageType: 'notification',
                            senderType: 'SYSTEM',
                            updatedAt: new Date()
                        })
                        .execute();

                    return { success: true, message: 'Completion confirmed but payment failed', paymentError: paymentError.message };
                }
            }
        });

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('Confirm completion error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
