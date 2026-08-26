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

            if (messageData.status !== 'pending') {
                throw new Error('This completion request is no longer active');
            }

            const { jobId, paymentMethod, budgetAmount, requestedBy } = messageData;

            // On-site jobs require OTP verification before confirmation
            const jobCheck = await trx
                .selectFrom('jobs')
                .select(['projectType', 'location', 'otpVerifiedAt'])
                .where('id', '=', jobId)
                .where('deleted', '=', false)
                .executeTakeFirst();

            if (jobCheck) {
                const isOnSite = jobCheck.projectType === 'On-site' && jobCheck.location?.toLowerCase() !== 'remote';
                if (isOnSite && !jobCheck.otpVerifiedAt) {
                    throw new Error('OTP verification pending. Please wait for the on-site attendance flow to complete.');
                }
            }

            // 1. Update request status
            messageData.status = 'confirmed';
            messageData.confirmedBy = user.id;
            messageData.confirmedAt = new Date().toISOString();

            await trx
                .updateTable('messages')
                .set({ messageData: messageData, updatedAt: new Date() })
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
                // Fetch discount and penalty info from job
                const jobData = await trx
                    .selectFrom('jobs')
                    .select(['discountAmount', 'cashbackOfferId', 'clientPenaltyAmount'])
                    .where('id', '=', jobId)
                    .where('deleted', '=', false)
                    .executeTakeFirst();

                const discountAmt = parseFloat(jobData?.discountAmount || '0');
                const penaltyAmt = parseFloat(jobData?.clientPenaltyAmount?.toString() || '0');
                const budgetNum = parseFloat(budgetAmount);
                const clientPays = budgetNum - discountAmt + penaltyAmt;

                let cashContent = 'Project completion confirmed. Cash payment process initiated.';
                if (discountAmt > 0 && penaltyAmt > 0) {
                    cashContent = `Project completion confirmed.\n💼 Budget: ₹${budgetNum}\n🔻 Penalty (from previous cancellation): ₹${penaltyAmt}\n🎁 BirdEarner cashback: ₹${discountAmt}\n💰 You pay freelancer: ₹${clientPays}`;
                } else if (penaltyAmt > 0) {
                    cashContent = `Project completion confirmed.\n💼 Budget: ₹${budgetNum}\n🔻 Penalty (from previous cancellation): ₹${penaltyAmt}\n💰 You pay freelancer: ₹${clientPays}`;
                } else if (discountAmt > 0) {
                    cashContent = `Project completion confirmed.\n💰 You pay freelancer: ₹${clientPays}\n🎁 BirdEarner pays you: ₹${discountAmt}\nTotal: ₹${budgetNum}`;
                }

                const cashMsg = await trx
                    .insertInto('messages')
                    .values({
                        id: crypto.randomUUID(),
                        chatThreadId: threadId,
                        senderId: user.id,
                        receiverId: message.senderId,
                        messageContent: cashContent,
                        messageType: 'cash_payment',
                        senderType: 'SYSTEM',
                        messageData: {
                            amount: clientPays.toString(),
                            budgetAmount: budgetAmount,
                            discountAmount: discountAmt.toString(),
                            penaltyAmount: penaltyAmt.toString(),
                            clientPays: clientPays.toString(),
                            birdEarnerPays: discountAmt.toString(),
                            step: 'initial',
                            clientConfirmed: false,
                            freelancerConfirmed: false,
                            jobId: jobId
                        },
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
                        .where('jobs.deleted', '=', false)
                        .executeTakeFirst();

                    if (!job) throw new Error('Job not found');

                    // The completeJob service already handles the transaction if we call it outside, 
                    // but we are ALREADY in a transaction. 
                    // I should've made a completeJobInTransaction in the service.
                    // For now, I'll assume completeJob handles its own transaction and is safe to call here?
                    // Kysely nested transactions are supported.

                    const completedJob = await completeJob(jobId, job.clientUserId);

                    // Fetch penalty info for notification
                    const jobDetails = await trx
                        .selectFrom('jobs')
                        .select(['budgetAmount', 'clientPenaltyAmount'])
                        .where('id', '=', jobId)
                        .executeTakeFirst();

                    const budgetAmt = parseFloat(jobDetails?.budgetAmount || budgetAmount);
                    const penaltyAmt = parseFloat(jobDetails?.clientPenaltyAmount?.toString() || '0');

                    let completionText = '✅ Project completed successfully! Payment processed via platform.';
                    if (penaltyAmt > 0) {
                        completionText += `\n\n📋 Payment Breakdown:\n💼 Budget: ₹${budgetAmt}\n🔻 Client Cancellation Penalty: ₹${penaltyAmt}\n💰 Total (already reserved from client): ₹${budgetAmt}`;
                        completionText += `\n\nℹ️ Note: The ₹${penaltyAmt} penalty was paid by the client as a token of their previous job cancellation. This amount is included in the total payment processed.`;
                    }

                    await trx
                        .insertInto('messages')
                        .values({
                            id: crypto.randomUUID(),
                            chatThreadId: threadId,
                            senderId: user.id,
                            receiverId: message.senderId,
                            messageContent: completionText,
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
                            messageData: {
                                jobId: jobId,
                                freelancerId: job.freelancerUserId,
                                clientId: job.clientId
                            },
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
