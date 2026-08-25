import { db } from '../db';
import { calculateBirdFee } from '../utils/fee';
import { reserveAmountForJobInTransaction, processJobPaymentInTransaction, releaseReservedAmountInTransaction } from './wallet';
import { sendNotification } from './notifications';
import { recordJobStatusHistory } from './timers';
import { DB, JobStatus } from '../../types/types';
import { Transaction } from 'kysely';

/**
 * Valid status transitions - prevents unauthorized state changes
 */
const VALID_TRANSITIONS: Record<string, string[]> = {
    OPEN: ['FREELANCER_APPLIED', 'NEGOTIATING', 'AWAITING_CLIENT_CONFIRMATION', 'CONFIRMED', 'EXPIRED', 'CANCELLED_BY_CLIENT'],
    FREELANCER_APPLIED: ['NEGOTIATING', 'AWAITING_CLIENT_CONFIRMATION', 'CONFIRMED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_FREELANCER', 'EXPIRED'],
    NEGOTIATING: ['AWAITING_CLIENT_CONFIRMATION', 'CONFIRMED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_FREELANCER'],
    AWAITING_CLIENT_CONFIRMATION: ['CONFIRMED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_FREELANCER'],
    CONFIRMED: ['FREELANCER_TRAVELLING', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_FREELANCER', 'DEADLINE_EXPIRED', 'DISPUTE_OPEN'],
    FREELANCER_TRAVELLING: ['ARRIVED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_FREELANCER', 'DISPUTE_OPEN'],
    ARRIVED: ['JOB_STARTED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_FREELANCER', 'DISPUTE_OPEN'],
    JOB_STARTED: ['WORK_ACCEPTED', 'WORK_SUBMITTED', 'COMPLETED', 'CANCELLED_BY_CLIENT', 'CANCELLED_BY_FREELANCER', 'DEADLINE_EXPIRED', 'DISPUTE_OPEN', 'CANCELLED_SCOPE_MISMATCH'],
    WORK_SUBMITTED: ['REVISION_REQUESTED', 'WORK_ACCEPTED', 'AUTO_ACCEPTED', 'COMPLETED'],
    REVISION_REQUESTED: ['REVISION_SUBMITTED'],
    REVISION_SUBMITTED: ['WORK_SUBMITTED'],
    WORK_ACCEPTED: ['COMPLETED', 'PAYMENT_PROCESSING'],
    COMPLETED: ['CLOSED', 'REFUNDED', 'DISPUTE_OPEN'],
    CANCELLED_BY_CLIENT: ['CLOSED', 'REFUNDED'],
    CANCELLED_BY_FREELANCER: ['CLOSED', 'REFUNDED'],
    DEADLINE_EXPIRED: ['CANCELLED_BY_FREELANCER', 'CLOSED'],
    DISPUTE_OPEN: ['DISPUTE_RESOLVED', 'CLOSED', 'REFUNDED'],
};

export function isValidStatusTransition(from: string, to: string): boolean {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed) return false;
    return allowed.includes(to);
}

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

    // 2. Timeline calculations
    // Application deadline starts automatically when job is posted (default: 24 hours)
    const applicationDeadline = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const workDurationDays = parseInt(jobData.workDurationDays || jobData.deadlineDays || 1, 10);

    const result = await db.transaction().execute(async (trx) => {
        // Check for pending client penalty
        const client = await trx
            .selectFrom('clients')
            .select(['id', 'pendingPenaltyAmount'])
            .where('id', '=', clientId)
            .executeTakeFirst();

        const penaltyAmount = parseFloat(client?.pendingPenaltyAmount?.toString() || '0');

        // 3. Create the job record
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
                applicationDeadline: applicationDeadline,
                applicationExtended: false,
                workDurationDays: workDurationDays,
                paymentMethod: jobData.paymentMethod || 'PLATFORM',
                attachedFiles: JSON.stringify(jobData.attachedFiles || []),
                location: jobData.location || null,
                latitude: jobData.latitude != null ? jobData.latitude.toString() : null,
                longitude: jobData.longitude != null ? jobData.longitude.toString() : null,
                isUrgent: jobData.isUrgent || false,
                clientPenaltyAmount: penaltyAmount > 0 ? penaltyAmount.toString() : '0',
                jobStatus: 'OPEN',
                paymentStatus: 'PENDING',
                isAmountReserved: false,
                updatedAt: new Date()
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        await recordJobStatusHistory(trx, job.id, 'OPEN', userId, 'CLIENT', 'CREATE_JOB', 'Job created by client');

        // Clear client's pending penalty
        if (penaltyAmount > 0) {
            await trx
                .updateTable('clients')
                .set({ pendingPenaltyAmount: '0', updatedAt: new Date() })
                .where('id', '=', clientId)
                .execute();
        }

        // 4. Handle Platform Payment Reservation
        if (job.paymentMethod === 'PLATFORM') {
            await reserveAmountForJobInTransaction(trx, userId, job.id, budgetAmount);

            // Update job to reserved status
            return await trx
                .updateTable('jobs')
                .set({
                    isAmountReserved: true,
                    paymentStatus: 'RESERVED',
                    updatedAt: new Date()
                })
                .where('id', '=', job.id)
                .returningAll()
                .executeTakeFirstOrThrow();
        }

        return job;
    });

    return result;
}

/**
 * Extend application deadline by +24 hours (Client action, max 1 extension)
 */
export async function extendApplicationDeadline(jobId: string, clientUserId: string) {
    return await db.transaction().execute(async (trx) => {
        const job = await trx
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .select([
                'jobs.id',
                'jobs.jobStatus',
                'jobs.applicationDeadline',
                'jobs.applicationExtended',
                'jobs.applicationExtensionCount',
                'jobs.applicationDeadlineOriginal',
                'clients.userId as clientUserId',
            ])
            .where('jobs.id', '=', jobId)
            .executeTakeFirst();

        if (!job) throw new Error('Job not found');
        if (job.clientUserId !== clientUserId) throw new Error('Unauthorized');
        if (job.jobStatus !== 'OPEN') throw new Error('Deadline extension is only allowed when job is OPEN');
        if (job.applicationExtensionCount >= 1) throw new Error('Application deadline can only be extended once');

        const currentDeadline = job.applicationDeadline ? new Date(job.applicationDeadline) : new Date();
        const extendedDeadline = new Date(currentDeadline.getTime() + 24 * 60 * 60 * 1000);

        const updatedJob = await trx
            .updateTable('jobs')
            .set({
                applicationDeadline: extendedDeadline,
                applicationExtended: true,
                applicationDeadlineOriginal: job.applicationDeadlineOriginal || job.applicationDeadline,
                applicationExtensionCount: (job.applicationExtensionCount || 0) + 1,
                updatedAt: new Date(),
            })
            .where('id', '=', jobId)
            .returningAll()
            .executeTakeFirstOrThrow();

        await recordJobStatusHistory(
            trx,
            jobId,
            'OPEN',
            clientUserId,
            'CLIENT',
            'EXTEND_APPLICATION_DEADLINE',
            'Application deadline extended by 24 hours',
            { previousDeadline: job.applicationDeadline, newDeadline: extendedDeadline }
        );

        return updatedJob;
    });
}

/**
 * Assign a freelancer to a job (Booking Confirmation)
 */
export async function assignFreelancer(jobId: string, freelancerId: string, clientUserId: string) {
    return await db.transaction().execute(async (trx) => {
        const job = await trx
            .selectFrom('jobs')
            .select(['id', 'budgetAmount', 'paymentMethod', 'isAmountReserved', 'jobTitle', 'clientPenaltyAmount', 'workDurationDays'])
            .where('id', '=', jobId)
            .executeTakeFirst();

        if (!job) throw new Error('Job not found');

        const penaltyAmount = parseFloat(job.clientPenaltyAmount?.toString() || '0');

        // Retrieve latest negotiation offers from chat thread
        const thread = await trx
            .selectFrom('chatThreads')
            .select(['id', 'clientOffer', 'freelancerOffer', 'agreedAmount', 'clientDays', 'freelancerDays', 'agreedDays'])
            .where('jobId', '=', jobId)
            .where('freelancerId', '=', freelancerId)
            .executeTakeFirst();

        const finalAmountStr = thread?.agreedAmount || thread?.freelancerOffer || thread?.clientOffer || job.budgetAmount.toString();
        const finalAmountNum = parseFloat(finalAmountStr);

        // Calculate Work Deadline from confirmed timestamp + agreed work duration
        const finalDays = thread?.agreedDays || thread?.freelancerDays || thread?.clientDays || job.workDurationDays || 1;
        const confirmedAt = new Date();
        const workDeadline = new Date(confirmedAt.getTime() + finalDays * 24 * 60 * 60 * 1000);

        // 1. If not already reserved (e.g. was CASH originally or failed), try to reserve now for PLATFORM using finalAmount
        if (!job.isAmountReserved && job.paymentMethod === 'PLATFORM') {
            await reserveAmountForJobInTransaction(trx, clientUserId, jobId, finalAmountNum);
        }

        // 2. Update job assignment with final negotiated budgetAmount and workDeadline
        const updatedJob = await trx
            .updateTable('jobs')
            .set({
                assignedFreelancerId: freelancerId,
                negotiatedAmount: finalAmountStr,
                workDurationDays: finalDays,
                workDeadline: workDeadline,
                deadlineDate: workDeadline,
                confirmedAt: confirmedAt,
                jobStatus: 'CONFIRMED',
                assignedAt: confirmedAt,
                updatedAt: confirmedAt
            })
            .where('id', '=', jobId)
            .returningAll()
            .executeTakeFirstOrThrow();

        await recordJobStatusHistory(
            trx,
            jobId,
            'CONFIRMED',
            clientUserId,
            'CLIENT',
            'CONFIRM_BOOKING',
            `Booking confirmed with freelancer. Work deadline set for ${workDeadline.toISOString()}`,
            { finalAmountStr, finalDays }
        );

        // 3. Update related chat threads with final agreedAmount and agreedDays
        await trx
            .updateTable('chatThreads')
            .set({
                status: 'ACCEPTED',
                isAccepted: true,
                agreedAmount: finalAmountStr,
                agreedDays: finalDays,
                deadline: workDeadline,
                updatedAt: new Date()
            })
            .where('jobId', '=', jobId)
            .where('freelancerId', '=', freelancerId)
            .execute();

        if (thread?.id) {
            await trx.insertInto('negotiationHistory').values({
                id: crypto.randomUUID(),
                chatThreadId: thread.id,
                jobId: jobId,
                senderId: clientUserId,
                senderType: 'SYSTEM',
                offerType: 'FINAL_AGREED',
                amount: finalAmountStr,
                previousAmount: null,
                days: finalDays,
                previousDays: null,
                note: finalDays ? `Freelancer assigned with agreed amount and ${finalDays} day${finalDays > 1 ? 's' : ''} deadline` : 'Freelancer assigned with agreed amount',
                createdAt: new Date(),
            }).execute();
        }

        await trx
            .updateTable('chatThreads')
            .set({ status: 'REJECTED', updatedAt: new Date() })
            .where('jobId', '=', jobId)
            .where('freelancerId', '!=', freelancerId)
            .execute();

        // 4. Get freelancer userId for message and notification
        const freelancer = await trx
            .selectFrom('freelancers')
            .select('userId')
            .where('id', '=', freelancerId)
            .executeTakeFirst();

        // 5. Send acceptance message in chat thread
        if (thread?.id && freelancer) {
            const daysText = finalDays ? ` and ${finalDays} day${finalDays > 1 ? 's' : ''} deadline` : '';

            // Message to freelancer: "Client accepted your request..."
            await trx.insertInto('messages').values({
                id: crypto.randomUUID(),
                chatThreadId: thread.id,
                jobId: jobId,
                senderId: clientUserId,
                receiverId: freelancer.userId,
                senderType: 'CLIENT',
                messageContent: `Client accepted your request with ₹${finalAmountStr}${daysText}`,
                messageType: 'text',
                isRead: false,
                updatedAt: new Date(),
            }).execute();

            // Message to client: "You accepted the request..."
            await trx.insertInto('messages').values({
                id: crypto.randomUUID(),
                chatThreadId: thread.id,
                jobId: jobId,
                senderId: clientUserId,
                receiverId: clientUserId,
                senderType: 'SYSTEM',
                messageContent: `You accepted the request with ₹${finalAmountStr}${daysText}`,
                messageType: 'text',
                isRead: false,
                updatedAt: new Date(),
            }).execute();
        }

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
                const penaltyMsg = `⚠️ Client Cancellation Penalty\n\nThis job includes a ₹${penaltyAmount.toFixed(2)} client cancellation penalty from a previously cancelled job. The client will pay this penalty amount to you along with the job payment. When the job is completed and payment is received, this penalty amount will be deducted from the total as the client has already paid it to you separately.`;

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

        // 1. Process Payment
        await processJobPaymentInTransaction(trx, jobId);

        // 2. Update Status
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
                'jobs.negotiatedAmount',
                'jobs.assignedFreelancerId',
                'jobs.isAmountReserved',
                'jobs.cashbackOfferId',
                'jobs.clientId',
                'jobs.jobTitle',
                'jobs.confirmedAt',
                'jobs.otpVerifiedAt',
                'jobs.submittedWorkData',
                'jobs.postOtpCancellationWindowExpiresAt',
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

        // Check 5-minute cancellation grace window
        const confirmedAtTime = job.confirmedAt ? new Date(job.confirmedAt).getTime() : 0;
        const isWithin5MinGrace = confirmedAtTime > 0 && (Date.now() - confirmedAtTime <= 5 * 60 * 1000);

        // Check 5-minute post-OTP emergency cancellation window
        const postOtpWindowExpiry = job.postOtpCancellationWindowExpiresAt ? new Date(job.postOtpCancellationWindowExpiresAt).getTime() : 0;
        const isWithinPostOtpWindow = postOtpWindowExpiry > 0 && Date.now() <= postOtpWindowExpiry;

        // If work started/submitted and past both grace windows, block simple cancellation
        if (!isWithin5MinGrace && !isWithinPostOtpWindow && (job.otpVerifiedAt || job.submittedWorkData)) {
            throw new Error('Normal cancellation is disabled after the emergency cancellation window. Please Raise a Dispute.');
        }

        const isClientCancelling = job.clientUserId === userId;
        const isFreelancerCancelling = job.freelancerUserId === userId;
        const isAssigned = !!job.assignedFreelancerId;

        // 1. Release Funds if reserved
        if (job.isAmountReserved) {
            await releaseReservedAmountInTransaction(trx, job.clientUserId, jobId);
        }

        // 2. Update status
        const cancelledStatus = isClientCancelling ? 'CANCELLED_BY_CLIENT' : (isFreelancerCancelling ? 'CANCELLED_BY_FREELANCER' : 'CANCELLED');
        const cancelledJob = await trx
            .updateTable('jobs')
            .set({
                jobStatus: cancelledStatus as any,
                paymentStatus: 'CANCELLED',
                isAmountReserved: false,
                cancellationReason: reason || null,
                cancelledAt: new Date(),
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

        // Client cancels assigned job: 0% penalty within 5-min grace window, 2% penalty after 5 mins
        if (isClientCancelling && isAssigned) {
            const effectiveAmount = job.negotiatedAmount ? parseFloat(job.negotiatedAmount.toString()) : parseFloat(job.budgetAmount.toString());
            const penaltyAmount = isWithin5MinGrace ? 0 : effectiveAmount * 0.02;

            if (penaltyAmount > 0) {
                await trx
                    .updateTable('clients')
                    .set((eb) => ({
                        pendingPenaltyAmount: eb('pendingPenaltyAmount', '+', penaltyAmount.toString()),
                        totalPenaltyPaid: eb('totalPenaltyPaid', '+', penaltyAmount.toString()),
                        updatedAt: new Date()
                    }))
                    .where('id', '=', job.clientId)
                    .execute();

                // Log penalty for client cancellation
                await trx.insertInto('penaltyLogs').values({
                    id: crypto.randomUUID(),
                    jobId: jobId,
                    clientId: job.clientId,
                    freelancerId: job.assignedFreelancerId || '',
                    penaltyType: 'CLIENT_CANCEL',
                    amount: penaltyAmount.toString(),
                    status: 'PENDING',
                    description: `Client cancelled job "${job.jobTitle}" after 5-min grace period. 2% penalty of ₹${penaltyAmount.toFixed(2)} will be charged on next job.`,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }).execute();
            }

            const cancelMsg = `Job "${job.jobTitle}" has been cancelled by the client${isWithin5MinGrace ? ' (within 5-min grace period, no penalty).' : '.'}`;

            await recordJobStatusHistory(
                trx,
                jobId,
                'CANCELLED_BY_CLIENT',
                userId,
                'CLIENT',
                'CANCEL_JOB',
                cancelMsg,
                { isWithin5MinGrace, penaltyAmount }
            );

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
                    messageData: JSON.stringify({ type: 'SYSTEM_CANCEL', cancelledBy: 'client', isWithin5MinGrace }),
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

        // Freelancer cancels assigned job: 0% penalty within 5-min grace window, 2% penalty after 5 mins
        if (isFreelancerCancelling && isAssigned && job.freelancerId) {
            const effectiveAmount = job.negotiatedAmount ? parseFloat(job.negotiatedAmount.toString()) : parseFloat(job.budgetAmount.toString());
            const penaltyAmount = isWithin5MinGrace ? 0 : effectiveAmount * 0.02;

            if (penaltyAmount > 0) {
                const currentBalance = parseFloat(job.withdrawableAmount?.toString() || '0');
                const newBalance = currentBalance - penaltyAmount;

                // Deduct penalty from freelancer wallet and update penalty tracking
                await trx
                    .updateTable('freelancers')
                    .set((eb) => ({
                        withdrawableAmount: newBalance.toString(),
                        totalPenaltyDeducted: eb('totalPenaltyDeducted', '+', penaltyAmount.toString()),
                        updatedAt: new Date()
                    }))
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
                        transactionType: 'PENALTY',
                        balanceBefore: currentBalance.toString(),
                        balanceAfter: newBalance.toString(),
                        description: `Cancellation penalty (2%) for job: ${job.jobTitle}${reason ? ` - Reason: ${reason}` : ''}`,
                        updatedAt: new Date()
                    })
                    .execute();

                // Log penalty for freelancer cancellation
                await trx.insertInto('penaltyLogs').values({
                    id: crypto.randomUUID(),
                    jobId: jobId,
                    clientId: job.clientId,
                    freelancerId: job.freelancerId,
                    penaltyType: 'FREELANCER_WALLET_DEDUCTED',
                    amount: penaltyAmount.toString(),
                    status: 'DEDUCTED',
                    description: `Freelancer cancelled job "${job.jobTitle}". 2% penalty of ₹${penaltyAmount.toFixed(2)} deducted from wallet.`,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }).execute();
            }

            const cancelMsg = `Job "${job.jobTitle}" has been cancelled by the freelancer${isWithin5MinGrace ? ' (within 5-min grace period, no penalty).' : '.'}`;

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
                    senderId: job.freelancerUserId!,
                    receiverId: job.clientUserId,
                    messageContent: cancelMsg,
                    messageType: 'text',
                    messageData: JSON.stringify({ type: 'SYSTEM_CANCEL', cancelledBy: 'freelancer', isWithin5MinGrace }),
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

/**
 * Handle Physical Service Progress Steps (I'm On My Way, Arrived, Request OTP, Verify OTP)
 */
export async function updatePhysicalJobProgress(
    jobId: string,
    action: 'TRAVELLING' | 'ARRIVED' | 'REQUEST_OTP' | 'VERIFY_OTP' | 'CONFIRM_WORK_COMPLETED' | 'EMERGENCY_CANCEL' | 'RAISE_DISPUTE',
    userId: string,
    payload?: { otpCode?: string }
) {
    return await db.transaction().execute(async (trx) => {
        const job = await trx
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
            .select([
                'jobs.id',
                'jobs.jobTitle',
                'jobs.jobStatus',
                'jobs.otpCode',
                'jobs.assignedFreelancerId',
                'jobs.postOtpCancellationWindowExpiresAt',
                'clients.userId as clientUserId',
                'freelancers.userId as freelancerUserId',
            ])
            .where('jobs.id', '=', jobId)
            .executeTakeFirst();

        if (!job) throw new Error('Job not found');

        const now = new Date();

        if (action === 'TRAVELLING') {
            if (job.freelancerUserId !== userId) throw new Error('Unauthorized');
            if (job.jobStatus !== 'CONFIRMED' && job.jobStatus !== 'IN_PROGRESS') {
                throw new Error('Freelancer can only mark travelling after booking is confirmed');
            }

            const updatedJob = await trx
                .updateTable('jobs')
                .set({ jobStatus: 'FREELANCER_TRAVELLING', travelStartedAt: now, updatedAt: now })
                .where('id', '=', jobId)
                .returningAll()
                .executeTakeFirstOrThrow();

            await recordJobStatusHistory(trx, jobId, 'FREELANCER_TRAVELLING', userId, 'FREELANCER', 'START_TRAVELLING', 'Freelancer is on the way');

            sendNotification(
                job.clientUserId,
                'CLIENT',
                'Freelancer On The Way',
                `Freelancer is on the way to your location for job "${job.jobTitle}".`,
                'FREELANCER_TRAVELLING',
                { jobId }
            );

            return updatedJob;
        }

        if (action === 'ARRIVED') {
            if (job.freelancerUserId !== userId) throw new Error('Unauthorized');
            if (job.jobStatus !== 'FREELANCER_TRAVELLING') {
                throw new Error('Freelancer must be travelling before marking as arrived');
            }

            const updatedJob = await trx
                .updateTable('jobs')
                .set({ jobStatus: 'ARRIVED', arrivedAt: now, updatedAt: now })
                .where('id', '=', jobId)
                .returningAll()
                .executeTakeFirstOrThrow();

            await recordJobStatusHistory(trx, jobId, 'ARRIVED', userId, 'FREELANCER', 'ARRIVED_AT_LOCATION', 'Freelancer arrived at client location');

            sendNotification(
                job.clientUserId,
                'CLIENT',
                'Freelancer Arrived',
                `Freelancer has arrived at your location for job "${job.jobTitle}".`,
                'FREELANCER_ARRIVED',
                { jobId }
            );

            return updatedJob;
        }

        if (action === 'REQUEST_OTP') {
            if (job.freelancerUserId !== userId) throw new Error('Unauthorized');
            if (job.jobStatus !== 'ARRIVED') {
                throw new Error('OTP can only be requested after freelancer has arrived at the location');
            }

            const otpCode = Math.floor(100000 + Math.random() * 900000).toString();

            const updatedJob = await trx
                .updateTable('jobs')
                .set({ otpCode, updatedAt: now })
                .where('id', '=', jobId)
                .returningAll()
                .executeTakeFirstOrThrow();

            sendNotification(
                job.clientUserId,
                'CLIENT',
                'Share OTP to Start Service',
                `Freelancer has requested the OTP for job "${job.jobTitle}". Please check your OTP section in the job details to view and share the OTP.`,
                'OTP_REQUESTED',
                { jobId }
            );

            return updatedJob;
        }

        if (action === 'VERIFY_OTP') {
            if (!payload?.otpCode) throw new Error('OTP code required');
            if (job.jobStatus !== 'ARRIVED') {
                throw new Error('OTP can only be verified after freelancer has arrived');
            }
            if (job.otpCode !== payload.otpCode.trim()) throw new Error('Invalid OTP code');

            const postOtpWindow = new Date(now.getTime() + 5 * 60 * 1000);

            const updatedJob = await trx
                .updateTable('jobs')
                .set({
                    jobStatus: 'JOB_STARTED',
                    otpVerifiedAt: now,
                    jobStartTime: now,
                    postOtpCancellationWindowExpiresAt: postOtpWindow,
                    updatedAt: now,
                })
                .where('id', '=', jobId)
                .returningAll()
                .executeTakeFirstOrThrow();

            await recordJobStatusHistory(trx, jobId, 'JOB_STARTED', userId, 'FREELANCER', 'VERIFY_OTP', 'OTP verified successfully. Job started.', {
                jobStartTime: now,
                postOtpCancellationWindowExpiresAt: postOtpWindow
            });

            if (job.freelancerUserId) {
                sendNotification(
                    job.freelancerUserId,
                    'FREELANCER',
                    'OTP Verified - Job Started',
                    `OTP verified for job "${job.jobTitle}". Work timer is active.`,
                    'JOB_STARTED',
                    { jobId }
                );
            }

            return updatedJob;
        }

        if (action === 'CONFIRM_WORK_COMPLETED') {
            if (job.clientUserId !== userId) throw new Error('Unauthorized - only client can confirm work completion');
            if (job.jobStatus !== 'JOB_STARTED') {
                throw new Error('Work can only be confirmed after OTP verification (JOB_STARTED)');
            }

            // Process payment for on-site job
            await processJobPaymentInTransaction(trx, jobId);

            const updatedJob = await trx
                .updateTable('jobs')
                .set({
                    jobStatus: 'COMPLETED',
                    clientConfirmedWorkAt: now,
                    completedAt: now,
                    paymentStatus: 'COMPLETED',
                    isAmountReserved: false,
                    updatedAt: now,
                })
                .where('id', '=', jobId)
                .returningAll()
                .executeTakeFirstOrThrow();

            await recordJobStatusHistory(trx, jobId, 'COMPLETED', userId, 'CLIENT', 'CONFIRM_WORK_COMPLETED', 'Client confirmed on-site work completed. Payment processed.');

            if (job.freelancerUserId) {
                sendNotification(
                    job.freelancerUserId,
                    'FREELANCER',
                    'Work Confirmed & Payment Released',
                    `Client has confirmed that work for "${job.jobTitle}" is completed. Payment has been released to your wallet.`,
                    'JOB_COMPLETED',
                    { jobId }
                );
            }

            return updatedJob;
        }

        if (action === 'EMERGENCY_CANCEL') {
            const postOtpWindow = job.postOtpCancellationWindowExpiresAt ? new Date(job.postOtpCancellationWindowExpiresAt) : null;
            if (!postOtpWindow || now > postOtpWindow) {
                throw new Error('Emergency cancellation window has expired. Please raise a dispute instead.');
            }

            const isClientUser = job.clientUserId === userId;
            const isFreelancerUser = job.freelancerUserId === userId;
            if (!isClientUser && !isFreelancerUser) throw new Error('Unauthorized');

            const updatedJob = await trx
                .updateTable('jobs')
                .set({
                    jobStatus: isClientUser ? 'CANCELLED_BY_CLIENT' : 'CANCELLED_BY_FREELANCER',
                    cancellationReason: 'Emergency cancellation within 5-minute post-OTP window',
                    updatedAt: now,
                })
                .where('id', '=', jobId)
                .returningAll()
                .executeTakeFirstOrThrow();

            await recordJobStatusHistory(trx, jobId, updatedJob.jobStatus, userId, isClientUser ? 'CLIENT' : 'FREELANCER', 'EMERGENCY_CANCEL', 'Emergency cancellation within 5-minute post-OTP window');

            const recipientId = isClientUser ? job.freelancerUserId : job.clientUserId;
            const recipientType = isClientUser ? 'FREELANCER' : 'CLIENT';
            if (recipientId) {
                sendNotification(
                    recipientId,
                    recipientType,
                    'Job Emergency Cancelled',
                    `Job "${job.jobTitle}" was emergency-cancelled within the 5-minute OTP window. No penalty applied.`,
                    'JOB_CANCELLED',
                    { jobId }
                );
            }

            return updatedJob;
        }

        if (action === 'RAISE_DISPUTE') {
            const isClientUser = job.clientUserId === userId;
            const isFreelancerUser = job.freelancerUserId === userId;
            if (!isClientUser && !isFreelancerUser) throw new Error('Unauthorized');

            const updatedJob = await trx
                .updateTable('jobs')
                .set({ jobStatus: 'DISPUTE_OPEN', updatedAt: now })
                .where('id', '=', jobId)
                .returningAll()
                .executeTakeFirstOrThrow();

            await recordJobStatusHistory(trx, jobId, 'DISPUTE_OPEN', userId, isClientUser ? 'CLIENT' : 'FREELANCER', 'RAISE_DISPUTE', 'Dispute raised');

            const recipientId = isClientUser ? job.freelancerUserId : job.clientUserId;
            const recipientType = isClientUser ? 'FREELANCER' : 'CLIENT';
            if (recipientId) {
                sendNotification(
                    recipientId,
                    recipientType,
                    'Dispute Opened',
                    `A dispute has been raised for job "${job.jobTitle}". Our team will review the case.`,
                    'DISPUTE_OPENED',
                    { jobId }
                );
            }

            return updatedJob;
        }

        throw new Error('Invalid action');
    });
}

/**
 * Handle Remote Service Work Submission
 */
export async function submitDigitalWork(
    jobId: string,
    freelancerUserId: string,
    workData: { fileUrl: string; notes?: string; watermarkText?: string; version?: number }
) {
    return await db.transaction().execute(async (trx) => {
        const job = await trx
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
            .select([
                'jobs.id',
                'jobs.jobTitle',
                'jobs.revisionCount',
                'clients.userId as clientUserId',
                'freelancers.userId as freelancerUserId',
            ])
            .where('jobs.id', '=', jobId)
            .executeTakeFirst();

        if (!job) throw new Error('Job not found');
        if (job.freelancerUserId !== freelancerUserId) throw new Error('Unauthorized');

        const now = new Date();
        const clientReviewPeriodExpiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000); // 12-hour review period

        const versionNumber = (job.revisionCount || 0) + 1;
        const submissionPayload = {
            version: versionNumber,
            fileUrl: workData.fileUrl,
            notes: workData.notes || '',
            watermarkText: workData.watermarkText || 'BirdEarner Watermarked Preview',
            submittedAt: now.toISOString(),
        };

        const updatedJob = await trx
            .updateTable('jobs')
            .set({
                jobStatus: 'WORK_SUBMITTED',
                submittedWorkData: JSON.stringify(submissionPayload),
                clientReviewPeriodExpiresAt: clientReviewPeriodExpiresAt,
                updatedAt: now,
            })
            .where('id', '=', jobId)
            .returningAll()
            .executeTakeFirstOrThrow();

        await recordJobStatusHistory(
            trx,
            jobId,
            'WORK_SUBMITTED',
            freelancerUserId,
            'FREELANCER',
            'SUBMIT_WORK',
            `Submitted Version ${versionNumber} work for client review`,
            submissionPayload
        );

        sendNotification(
            job.clientUserId,
            'CLIENT',
            'Work Submitted for Review',
            `Your freelancer uploaded work for "${job.jobTitle}". Please review the submitted work within 12 hours.`,
            'WORK_SUBMITTED',
            { jobId }
        );

        return updatedJob;
    });
}

/**
 * Handle Client Response to Submitted Work (Accept Work or Request Changes)
 */
export async function respondToDigitalWork(
    jobId: string,
    clientUserId: string,
    decision: 'ACCEPT' | 'REQUEST_REVISION',
    notes?: string
) {
    return await db.transaction().execute(async (trx) => {
        const job = await trx
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
            .select([
                'jobs.id',
                'jobs.jobTitle',
                'jobs.budgetAmount',
                'jobs.revisionCount',
                'clients.userId as clientUserId',
                'freelancers.id as freelancerId',
                'freelancers.userId as freelancerUserId',
            ])
            .where('jobs.id', '=', jobId)
            .executeTakeFirst();

        if (!job) throw new Error('Job not found');
        if (job.clientUserId !== clientUserId) throw new Error('Unauthorized');

        const now = new Date();

        if (decision === 'ACCEPT') {
            await processJobPaymentInTransaction(trx, jobId);

            const updatedJob = await trx
                .updateTable('jobs')
                .set({
                    jobStatus: 'WORK_ACCEPTED',
                    completedAt: now,
                    paymentStatus: 'COMPLETED',
                    amountPaid: job.budgetAmount,
                    isAmountReserved: false,
                    clientReviewPeriodExpiresAt: null,
                    updatedAt: now,
                })
                .where('id', '=', jobId)
                .returningAll()
                .executeTakeFirstOrThrow();

            await recordJobStatusHistory(trx, jobId, 'WORK_ACCEPTED', clientUserId, 'CLIENT', 'ACCEPT_WORK', 'Client accepted final work submission');

            if (job.freelancerUserId) {
                sendNotification(
                    job.freelancerUserId,
                    'FREELANCER',
                    'Work Accepted & Payment Released',
                    `Your work for "${job.jobTitle}" was accepted by the client. Payment has been released to your wallet.`,
                    'JOB_COMPLETED',
                    { jobId }
                );
            }

            return updatedJob;
        }

        if (decision === 'REQUEST_REVISION') {
            const newRevisionCount = (job.revisionCount || 0) + 1;

            const updatedJob = await trx
                .updateTable('jobs')
                .set({
                    jobStatus: 'REVISION_REQUESTED',
                    revisionCount: newRevisionCount,
                    clientReviewPeriodExpiresAt: null, // Pause/reset 12-hour review timer
                    updatedAt: now,
                })
                .where('id', '=', jobId)
                .returningAll()
                .executeTakeFirstOrThrow();

            await recordJobStatusHistory(
                trx,
                jobId,
                'REVISION_REQUESTED',
                clientUserId,
                'CLIENT',
                'REQUEST_REVISION',
                notes || 'Client requested revisions on submitted work',
                { revisionCount: newRevisionCount }
            );

            if (job.freelancerUserId) {
                sendNotification(
                    job.freelancerUserId,
                    'FREELANCER',
                    'Revision Requested',
                    `Client requested changes for "${job.jobTitle}": ${notes || 'Please check project details.'}`,
                    'REVISION_REQUESTED',
                    { jobId }
                );
            }

            return updatedJob;
        }

        throw new Error('Invalid decision');
    });
}

/**
 * Handle Scope Mismatch Price Change Request (Freelancer Action)
 */
export async function requestScopePriceChange(
    jobId: string,
    freelancerUserId: string,
    requestedAmount: number,
    reason: string
) {
    return await db.transaction().execute(async (trx) => {
        const job = await trx
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
            .select([
                'jobs.id',
                'jobs.jobTitle',
                'jobs.budgetAmount',
                'clients.userId as clientUserId',
                'freelancers.userId as freelancerUserId',
            ])
            .where('jobs.id', '=', jobId)
            .executeTakeFirst();

        if (!job) throw new Error('Job not found');
        if (job.freelancerUserId !== freelancerUserId) throw new Error('Unauthorized');

        const now = new Date();

        const updatedJob = await trx
            .updateTable('jobs')
            .set({
                priceChangeRequested: requestedAmount.toString(),
                priceChangeReason: reason,
                updatedAt: now,
            })
            .where('id', '=', jobId)
            .returningAll()
            .executeTakeFirstOrThrow();

        sendNotification(
            job.clientUserId,
            'CLIENT',
            'Price Change Requested (Scope Mismatch)',
            `Freelancer requested to update booking amount from ₹${job.budgetAmount} to ₹${requestedAmount}. Reason: ${reason}`,
            'PRICE_CHANGE_REQUESTED',
            { jobId, requestedAmount, reason }
        );

        return updatedJob;
    });
}

/**
 * Handle Client Response to Scope Mismatch Price Change
 */
export async function respondToScopePriceChange(
    jobId: string,
    clientUserId: string,
    accept: boolean
) {
    return await db.transaction().execute(async (trx) => {
        const job = await trx
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
            .select([
                'jobs.id',
                'jobs.jobTitle',
                'jobs.budgetAmount',
                'jobs.isAmountReserved',
                'jobs.priceChangeRequested',
                'jobs.priceChangeReason',
                'jobs.clientId',
                'clients.userId as clientUserId',
                'freelancers.id as freelancerId',
                'freelancers.userId as freelancerUserId',
            ])
            .where('jobs.id', '=', jobId)
            .executeTakeFirst();

        if (!job) throw new Error('Job not found');
        if (job.clientUserId !== clientUserId) throw new Error('Unauthorized');

        const now = new Date();

        if (accept) {
            if (!job.priceChangeRequested) throw new Error('No price change request pending');
            const newAmount = job.priceChangeRequested.toString();

            const updatedJob = await trx
                .updateTable('jobs')
                .set({
                    budgetAmount: newAmount,
                    priceChangeRequested: null,
                    priceChangeReason: null,
                    updatedAt: now,
                })
                .where('id', '=', jobId)
                .returningAll()
                .executeTakeFirstOrThrow();

            if (job.freelancerUserId) {
                sendNotification(
                    job.freelancerUserId,
                    'FREELANCER',
                    'Price Change Accepted',
                    `Client accepted new booking price of ₹${newAmount} for "${job.jobTitle}".`,
                    'PRICE_CHANGE_ACCEPTED',
                    { jobId }
                );
            }

            return updatedJob;
        } else {
            // Client declines -> Cancel booking due to scope mismatch with 0 penalty for both!
            if (job.isAmountReserved) {
                await releaseReservedAmountInTransaction(trx, job.clientUserId, jobId);
            }

            const updatedJob = await trx
                .updateTable('jobs')
                .set({
                    jobStatus: 'CANCELLED_BY_CLIENT',
                    paymentStatus: 'CANCELLED',
                    cancellationReason: 'CANCELLED - SCOPE/PRICE MISMATCH',
                    priceChangeRequested: null,
                    priceChangeReason: null,
                    cancelledAt: now,
                    updatedAt: now,
                })
                .where('id', '=', jobId)
                .returningAll()
                .executeTakeFirstOrThrow();

            await recordJobStatusHistory(
                trx,
                jobId,
                'CANCELLED_BY_CLIENT',
                clientUserId,
                'CLIENT',
                'CANCEL_SCOPE_MISMATCH',
                'Cancelled due to scope mismatch / price change disagreement (No penalty)'
            );

            if (job.freelancerUserId) {
                sendNotification(
                    job.freelancerUserId,
                    'FREELANCER',
                    'Booking Cancelled - Scope Mismatch',
                    `Job "${job.jobTitle}" was cancelled due to price change disagreement. No penalty applied.`,
                    'JOB_CANCELLED',
                    { jobId }
                );
            }

            return updatedJob;
        }
    });
}
