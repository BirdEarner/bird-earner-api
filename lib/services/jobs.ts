import { db } from '../db';
import { calculateBirdFee } from '../utils/fee';
import { sendNotification } from './notifications';
import { DB, JobStatus } from '../../types/types';
import { Transaction } from 'kysely';

/**
 * Create a new job with platform payment or cash flow
 */
export async function createJob(jobData: any, userId: string, clientId: string) {
    const budgetAmount = parseFloat(jobData.budgetAmount);

    // 1. Bird Fee Calculation
    let birdFeeAmount = 0;
    if (jobData.serviceId) {
        const service = await db
            .selectFrom('services')
            .select('birdFee')
            .where('id', '=', jobData.serviceId)
            .executeTakeFirst();

        if (service?.birdFee) {
            birdFeeAmount = calculateBirdFee(budgetAmount, service.birdFee);
        }
    }

    const result = await db.transaction().execute(async (trx) => {
        // Check for pending client penalty
        const client = await trx
            .selectFrom('clients')
            .select(['id', 'pendingPenaltyAmount'])
            .where('id', '=', clientId)
            .executeTakeFirst();

        const penaltyAmount = parseFloat(client?.pendingPenaltyAmount?.toString() || '0');

        // 2. Create the job record
        const job = await trx
            .insertInto('jobs')
            .values({
                id: crypto.randomUUID(),
                jobTitle: jobData.jobTitle,
                jobDescription: jobData.jobDescription,
                jobCategory: jobData.jobCategory,
                jobSubCategory: jobData.jobSubCategory,
                skillsRequired: JSON.stringify(jobData.skillsRequired || []),
                projectType: jobData.projectType,
                budgetType: jobData.budgetType,
                budgetAmount: budgetAmount.toString(),
                birdFeeAmount: birdFeeAmount.toString(),
                clientId,
                serviceId: jobData.serviceId || null,
                deadlineDate: jobData.deadlineDate ? new Date(jobData.deadlineDate) : null,
                paymentMethod: jobData.paymentMethod || 'PLATFORM',
                attachedFiles: JSON.stringify(jobData.attachedFiles || []),
                location: jobData.location || null,
                isUrgent: jobData.isUrgent || false,
                clientPenaltyAmount: penaltyAmount > 0 ? penaltyAmount.toString() : '0',
                jobStatus: 'OPEN',
                paymentStatus: 'PENDING',
                isAmountReserved: false,
                updatedAt: new Date()
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        // Clear client's pending penalty
        if (penaltyAmount > 0) {
            await trx
                .updateTable('clients')
                .set({ pendingPenaltyAmount: '0', updatedAt: new Date() })
                .where('id', '=', clientId)
                .execute();
        }

        return job;
    });

    return result;
}

/**
 * Assign a freelancer to a job
 */
export async function assignFreelancer(jobId: string, freelancerId: string, clientUserId: string) {
    return await db.transaction().execute(async (trx) => {
        const job = await trx
            .selectFrom('jobs')
            .select(['id', 'budgetAmount', 'paymentMethod', 'isAmountReserved', 'jobTitle', 'clientPenaltyAmount'])
            .where('id', '=', jobId)
            .executeTakeFirst();

        if (!job) throw new Error('Job not found');

        const penaltyAmount = parseFloat(job.clientPenaltyAmount?.toString() || '0');

        // Retrieve latest negotiation offers from chat thread
        const thread = await trx
            .selectFrom('chatThreads')
            .select(['id', 'clientOffer', 'freelancerOffer', 'agreedAmount'])
            .where('jobId', '=', jobId)
            .where('freelancerId', '=', freelancerId)
            .executeTakeFirst();

        const finalAmountStr = thread?.agreedAmount || thread?.freelancerOffer || thread?.clientOffer || job.budgetAmount.toString();

        // 1. Update job assignment with final negotiated budgetAmount
        const updatedJob = await trx
            .updateTable('jobs')
            .set({
                assignedFreelancerId: freelancerId,
                budgetAmount: finalAmountStr,
                jobStatus: 'IN_PROGRESS',
                assignedAt: new Date(),
                updatedAt: new Date()
            })
            .where('id', '=', jobId)
            .returningAll()
            .executeTakeFirstOrThrow();

        // 3. Update related chat threads with final agreedAmount
        await trx
            .updateTable('chatThreads')
            .set({
                status: 'ACCEPTED',
                isAccepted: true,
                agreedAmount: finalAmountStr,
                updatedAt: new Date()
            })
            .where('jobId', '=', jobId)
            .where('freelancerId', '=', freelancerId)
            .execute();

        await trx.insertInto('negotiationHistory').values({
            id: crypto.randomUUID(),
            chatThreadId: thread?.id || '',
            jobId: jobId,
            senderId: clientUserId,
            senderType: 'SYSTEM',
            offerType: 'FINAL_AGREED',
            amount: finalAmountStr,
            previousAmount: null,
            note: 'Freelancer assigned with agreed amount',
            createdAt: new Date(),
        }).execute();

        await trx
            .updateTable('chatThreads')
            .set({ status: 'REJECTED', updatedAt: new Date() })
            .where('jobId', '=', jobId)
            .where('freelancerId', '!=', freelancerId)
            .execute();

        // 4. Notify freelancer
        const freelancer = await trx
            .selectFrom('freelancers')
            .select('userId')
            .where('id', '=', freelancerId)
            .executeTakeFirst();

        if (freelancer) {
            sendNotification(
                freelancer.userId,
                'FREELANCER',
                'Job Assigned',
                `You have been assigned to: ${job.jobTitle}`,
                'JOB_ASSIGNED',
                { jobId }
            );
        }

        // Send penalty info message to chat if there is a penalty
        if (penaltyAmount > 0 && thread?.id) {
            const freelancerUser = await trx
                .selectFrom('freelancers')
                .select('userId')
                .where('id', '=', freelancerId)
                .executeTakeFirst();

            if (freelancerUser) {
                const penaltyMsg = `⚠️ Client Cancellation Penalty\n\nThis job includes a ₹${penaltyAmount.toFixed(2)} client cancellation penalty from a previously cancelled job. This amount will be deducted from your wallet when the job is completed.`;

                await trx.insertInto('messages').values({
                    id: crypto.randomUUID(),
                    chatThreadId: thread.id,
                    senderId: clientUserId,
                    receiverId: freelancerUser.userId,
                    messageContent: penaltyMsg,
                    messageType: 'text',
                    messageData: JSON.stringify({ penaltyAmount }),
                    senderType: 'CLIENT',
                    isRead: false,
                    updatedAt: new Date()
                }).execute();
            }
        }

        return updatedJob;
    });
}

/**
 * Reject a freelancer application for a job
 */
export async function rejectFreelancer(jobId: string, freelancerId: string, clientUserId: string) {
    return await db.transaction().execute(async (trx) => {
        // Verify job exists and belongs to this client
        const job = await trx
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .select(['jobs.id', 'clients.userId as clientUserId'])
            .where('jobs.id', '=', jobId)
            .executeTakeFirst();

        if (!job) throw new Error('Job not found');
        if (job.clientUserId !== clientUserId) throw new Error('Unauthorized');

        // Update all matching chat threads for this job + freelancer
        await trx
            .updateTable('chatThreads')
            .set({ status: 'REJECTED', updatedAt: new Date() })
            .where('jobId', '=', jobId)
            .where('freelancerId', '=', freelancerId)
            .execute();

        // Fetch the job and its chat threads to return
        const updatedJob = await trx
            .selectFrom('jobs')
            .selectAll()
            .where('id', '=', jobId)
            .executeTakeFirst();

        const threads = await trx
            .selectFrom('chatThreads')
            .selectAll()
            .where('jobId', '=', jobId)
            .where('freelancerId', '=', freelancerId)
            .execute();

        const freelancer = await trx
            .selectFrom('freelancers')
            .select('userId')
            .where('id', '=', freelancerId)
            .executeTakeFirst();

        if (freelancer) {
            sendNotification(
                freelancer.userId,
                'FREELANCER',
                'Application Rejected',
                `Your application for job ${jobId} has been rejected.`,
                'APPLICATION_REJECTED',
                { jobId }
            );
        }

        // Return job along with the affected threads
        return {
            ...updatedJob,
            chatThreads: threads,
        } as any;
    });
}

/**
 * Complete a job
 */
export async function completeJob(jobId: string, clientUserId: string) {
    return await db.transaction().execute(async (trx) => {
        const job = await trx
            .selectFrom('jobs')
            .select(['id', 'clientId', 'assignedFreelancerId', 'jobTitle', 'budgetAmount'])
            .where('id', '=', jobId)
            .executeTakeFirst();

        if (!job) throw new Error('Job not found');

        // Verify client
        const client = await trx
            .selectFrom('clients')
            .select('id')
            .where('userId', '=', clientUserId)
            .executeTakeFirst();

        if (!client || job.clientId !== client.id) {
            throw new Error('Unauthorized');
        }

        // 1. Update Status
        const completedJob = await trx
            .updateTable('jobs')
            .set({
                jobStatus: 'COMPLETED',
                completedAt: new Date(),
                paymentStatus: 'COMPLETED',
                amountPaid: job.budgetAmount,
                isAmountReserved: false,
                updatedAt: new Date()
            })
            .where('id', '=', jobId)
            .returningAll()
            .executeTakeFirstOrThrow();

        // 3. Notify Freelancer
        if (job.assignedFreelancerId) {
            const freelancer = await trx
                .selectFrom('freelancers')
                .select('userId')
                .where('id', '=', job.assignedFreelancerId)
                .executeTakeFirst();

            if (freelancer) {
                sendNotification(
                    freelancer.userId,
                    'FREELANCER',
                    'Job Completed',
                    `Job "${job.jobTitle}" has been marked as completed.`,
                    'JOB_COMPLETED',
                    { jobId }
                );
            }
        }

        return completedJob;
    });
}

/**
 * Cancel a job
 */
export async function cancelJob(jobId: string, userId: string, reason?: string) {
    return await db.transaction().execute(async (trx) => {
        const job = await trx
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
            .select([
                'jobs.id',
                'jobs.budgetAmount',
                'jobs.assignedFreelancerId',
                'jobs.isAmountReserved',
                'jobs.cashbackOfferId',
                'jobs.clientId',
                'jobs.jobTitle',
                'clients.userId as clientUserId',
                'freelancers.id as freelancerId',
                'freelancers.userId as freelancerUserId',
                'freelancers.withdrawableAmount'
            ])
            .where('jobs.id', '=', jobId)
            .executeTakeFirst();

        if (!job) throw new Error('Job not found');

        // Auth check
        if (job.clientUserId !== userId && job.freelancerUserId !== userId) {
            throw new Error('Unauthorized');
        }

        // 1. Update status
        const cancelledJob = await trx
            .updateTable('jobs')
            .set({
                jobStatus: 'CANCELLED',
                paymentStatus: 'CANCELLED',
                isAmountReserved: false,
                updatedAt: new Date()
            })
            .where('id', '=', jobId)
            .returningAll()
            .executeTakeFirstOrThrow();

        // Release reserved coupon if any
        if (job.cashbackOfferId) {
            await trx
                .updateTable('cashbackOffers')
                .set({ reservedJobId: null, updatedAt: new Date() })
                .where('id', '=', job.cashbackOfferId)
                .execute();
        }

        const isClientCancelling = job.clientUserId === userId;
        const isFreelancerCancelling = job.freelancerUserId === userId;
        const isAssigned = !!job.assignedFreelancerId;

        // Client cancels assigned job → 2% penalty stored as pending for next job
        if (isClientCancelling && isAssigned) {
            const budget = parseFloat(job.budgetAmount.toString());
            const penaltyAmount = budget * 0.02;

            await trx
                .updateTable('clients')
                .set((eb) => ({
                    pendingPenaltyAmount: eb('pendingPenaltyAmount', '+', penaltyAmount.toString()),
                    updatedAt: new Date()
                }))
                .where('id', '=', job.clientId)
                .execute();

            const cancelMsg = `Job "${job.jobTitle}" has been cancelled by the client.${reason ? ` Reason: ${reason}` : ''}`;

            // Send system message in chat thread
            const thread = await trx
                .selectFrom('chatThreads')
                .select(['id', 'freelancerId'])
                .where('jobId', '=', jobId)
                .executeTakeFirst();

            if (thread) {
                const freelancer = thread.freelancerId ? await trx
                    .selectFrom('freelancers')
                    .select('userId')
                    .where('id', '=', thread.freelancerId)
                    .executeTakeFirst() : null;

                await trx.insertInto('messages').values({
                    id: crypto.randomUUID(),
                    chatThreadId: thread.id,
                    senderId: job.clientUserId,
                    receiverId: freelancer?.userId || '',
                    messageContent: cancelMsg,
                    messageType: 'text',
                    messageData: JSON.stringify({ type: 'SYSTEM_CANCEL', cancelledBy: 'client' }),
                    senderType: 'SYSTEM',
                    isRead: false,
                    updatedAt: new Date()
                }).execute();
            }

            // Notify freelancer
            if (job.freelancerUserId) {
                sendNotification(
                    job.freelancerUserId,
                    'FREELANCER',
                    'Job Cancelled by Client',
                    cancelMsg,
                    'JOB_CANCELLED',
                    { jobId }
                );
            }

            // Notify client
            sendNotification(
                job.clientUserId,
                'CLIENT',
                'Job Cancelled by Client',
                cancelMsg,
                'JOB_CANCELLED',
                { jobId }
            );
        }

        // Freelancer cancels assigned job → 2% penalty deducted immediately from wallet
        if (isFreelancerCancelling && isAssigned && job.freelancerId) {
            const budget = parseFloat(job.budgetAmount.toString());
            const penaltyAmount = budget * 0.02;
            const currentBalance = parseFloat(job.withdrawableAmount?.toString() || '0');
            const newBalance = currentBalance - penaltyAmount;

            // Deduct penalty from freelancer wallet
            await trx
                .updateTable('freelancers')
                .set({ withdrawableAmount: newBalance.toString(), updatedAt: new Date() })
                .where('id', '=', job.freelancerId)
                .execute();

            // Record wallet transaction
            await trx
                .insertInto('walletTransactions')
                .values({
                    id: crypto.randomUUID(),
                    userId: job.freelancerUserId!,
                    userType: 'FREELANCER',
                    jobId: job.id,
                    amount: (-penaltyAmount).toString(),
                    transactionType: 'PLATFORM_FEE',
                    balanceBefore: currentBalance.toString(),
                    balanceAfter: newBalance.toString(),
                    description: `Cancellation penalty (2%) for job: ${job.jobTitle}${reason ? ` - Reason: ${reason}` : ''}`,
                    updatedAt: new Date()
                })
                .execute();

            const cancelMsg = `Job "${job.jobTitle}" has been cancelled by the freelancer. 2% penalty (₹${penaltyAmount.toFixed(2)}) has been deducted from their wallet.${reason ? ` Reason: ${reason}` : ''}`;

            // Send system message in chat thread
            const thread = await trx
                .selectFrom('chatThreads')
                .select(['id'])
                .where('jobId', '=', jobId)
                .executeTakeFirst();

            if (thread) {
                await trx.insertInto('messages').values({
                    id: crypto.randomUUID(),
                    chatThreadId: thread.id,
                    senderId: job.freelancerUserId!,
                    receiverId: job.clientUserId,
                    messageContent: cancelMsg,
                    messageType: 'text',
                    messageData: JSON.stringify({ type: 'SYSTEM_CANCEL', cancelledBy: 'freelancer', penaltyAmount }),
                    senderType: 'SYSTEM',
                    isRead: false,
                    updatedAt: new Date()
                }).execute();
            }

            // Notify freelancer
            if (job.freelancerUserId) {
                sendNotification(
                    job.freelancerUserId,
                    'FREELANCER',
                    'Job Cancelled by Freelancer',
                    cancelMsg,
                    'JOB_CANCELLED',
                    { jobId }
                );
            }

            // Notify client
            sendNotification(
                job.clientUserId,
                'CLIENT',
                'Job Cancelled by Freelancer',
                cancelMsg,
                'JOB_CANCELLED',
                { jobId }
            );
        }

        return cancelledJob;
    });
}
