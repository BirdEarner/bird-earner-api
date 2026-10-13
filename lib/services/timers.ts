import { db } from '../db';
import { sql } from 'kysely';
import { processJobPaymentInTransaction, releaseReservedAmountInTransaction } from './wallet';
import { sendNotification } from './notifications';
import { isOnSiteJob } from '../job-type';

/**
 * Audit status change helper
 */
export async function recordJobStatusHistory(
    trx: any,
    jobId: string,
    status: string,
    changedBy?: string,
    userType?: string,
    action?: string,
    reason?: string,
    metadata?: any
) {
    await trx.insertInto('jobStatusHistory').values({
        id: crypto.randomUUID(),
        jobId,
        status,
        changedBy: changedBy || null,
        userType: userType || 'SYSTEM',
        action: action || null,
        reason: reason || null,
        metadata: metadata ? JSON.stringify(metadata) : null,
        createdAt: new Date(),
    }).execute();
}

/**
 * Add N business days to a date (skips Saturdays and Sundays)
 */
function addBusinessDays(from: Date, days: number): Date {
    const result = new Date(from.getTime());
    let added = 0;
    while (added < days) {
        result.setDate(result.getDate() + 1);
        const day = result.getDay();
        if (day !== 0 && day !== 6) added++;
    }
    return result;
}

/**
 * Process automatic job timers (Application deadline, 12h review auto-accept, 12h work deadline grace period / On-site auto-cancel)
 */
export async function processJobTimers() {
    const now = new Date();

    // 1. Auto-accept WORK_SUBMITTED jobs where clientReviewPeriodExpiresAt <= now
    const autoAcceptJobs = await db
        .selectFrom('jobs')
        .select(['id', 'jobTitle', 'assignedFreelancerId', 'clientId', 'budgetAmount', 'negotiatedAmount'])
        .where('jobStatus', '=', 'WORK_SUBMITTED')
        .where('clientReviewPeriodExpiresAt', '<=', now)
        .execute();

    for (const job of autoAcceptJobs) {
        try {
            await db.transaction().execute(async (trx) => {
                const currentJob = await trx
                    .selectFrom('jobs')
                    .select('jobStatus')
                    .where('id', '=', job.id)
                    .forUpdate()
                    .executeTakeFirst();

                if (!currentJob || currentJob.jobStatus !== 'WORK_SUBMITTED') {
                    return;
                }

                const paymentResult = await processJobPaymentInTransaction(trx, job.id);

                await trx
                    .updateTable('jobs')
                    .set({
                        jobStatus: 'AUTO_ACCEPTED',
                        completedAt: now,
                        paymentStatus: 'COMPLETED',
                        amountPaid: paymentResult.clientChargeAmount.toFixed(2),
                        isAmountReserved: false,
                        updatedAt: now,
                    })
                    .where('id', '=', job.id)
                    .execute();

                await recordJobStatusHistory(
                    trx,
                    job.id,
                    'AUTO_ACCEPTED',
                    undefined,
                    'SYSTEM',
                    'AUTO_ACCEPT_12H_EXPIRED',
                    'Client did not respond within 12-hour review period. Work automatically accepted.'
                );

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
                            'Work Auto-Accepted',
                            `Work for "${job.jobTitle}" was automatically accepted. Payment released to your wallet.`,
                            'JOB_COMPLETED',
                            { jobId: job.id }
                        );
                    }
                }
            });
        } catch (err) {
            console.error(`Failed to auto-accept job ${job.id}:`, err);
        }
    }

    // 2. Client review period reminders (6h midpoint + final 1h before expiry)
    const sixHoursFromNow = new Date(now.getTime() + 6 * 60 * 60 * 1000);
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    const reviewReminderJobs = await db
        .selectFrom('jobs')
        .innerJoin('clients', 'clients.id', 'jobs.clientId')
        .select([
            'jobs.id as id',
            'jobs.jobTitle as jobTitle',
            'jobs.clientReviewPeriodExpiresAt as clientReviewPeriodExpiresAt',
            'jobs.clientReviewReminderSentAt as clientReviewReminderSentAt',
            'jobs.clientReviewFinalReminderSentAt as clientReviewFinalReminderSentAt',
            'clients.userId as clientUserId',
        ])
        .where('jobs.jobStatus', '=', 'WORK_SUBMITTED')
        .where('jobs.clientReviewPeriodExpiresAt', 'is not', null)
        .where('jobs.clientReviewPeriodExpiresAt', '<=', sixHoursFromNow)
        .where('jobs.clientReviewPeriodExpiresAt', '>', now)
        .where((eb) => eb.or([eb('jobs.clientReviewReminderSentAt', 'is', null), eb('jobs.clientReviewFinalReminderSentAt', 'is', null)]))
        .execute();

    for (const job of reviewReminderJobs) {
        const expiresAt = job.clientReviewPeriodExpiresAt;
        if (!expiresAt) continue;

        const sendMidReminder = !job.clientReviewReminderSentAt && expiresAt.getTime() <= sixHoursFromNow.getTime();
        const sendFinalReminder = !job.clientReviewFinalReminderSentAt && expiresAt.getTime() <= oneHourFromNow.getTime();
        if (!sendMidReminder && !sendFinalReminder) continue;

        try {
            await db.transaction().execute(async (trx) => {
                const currentJob = await trx
                    .selectFrom('jobs')
                    .select(['jobStatus', 'clientReviewPeriodExpiresAt', 'clientReviewReminderSentAt', 'clientReviewFinalReminderSentAt'])
                    .where('id', '=', job.id)
                    .forUpdate()
                    .executeTakeFirst();

                if (!currentJob || currentJob.jobStatus !== 'WORK_SUBMITTED') {
                    return;
                }

                const currentExpiresAt = currentJob.clientReviewPeriodExpiresAt;
                if (!currentExpiresAt || currentExpiresAt.getTime() <= now.getTime()) {
                    return;
                }

                if (sendMidReminder && !currentJob.clientReviewReminderSentAt && currentExpiresAt.getTime() <= sixHoursFromNow.getTime()) {
                    await trx
                        .updateTable('jobs')
                        .set({ clientReviewReminderSentAt: new Date(), updatedAt: new Date() })
                        .where('id', '=', job.id)
                        .execute();

                    sendNotification(
                        job.clientUserId,
                        'CLIENT',
                        'Work Review Reminder',
                        'Reminder: Your Freelancer is waiting for your review. Please review the submitted work and respond.',
                        'WORK_SUBMITTED',
                        { jobId: job.id }
                    );
                }

                if (sendFinalReminder && !currentJob.clientReviewFinalReminderSentAt && currentExpiresAt.getTime() <= oneHourFromNow.getTime()) {
                    await trx
                        .updateTable('jobs')
                        .set({ clientReviewFinalReminderSentAt: new Date(), updatedAt: new Date() })
                        .where('id', '=', job.id)
                        .execute();

                    sendNotification(
                        job.clientUserId,
                        'CLIENT',
                        'Final Review Reminder',
                        "Final Review Reminder: Please review the submitted work. If you do not respond within the remaining review period, the work may be automatically accepted according to BirdEarner's completion policy.",
                        'WORK_SUBMITTED',
                        { jobId: job.id }
                    );
                }
            });
        } catch (err) {
            console.error(`Failed to send client review reminders for job ${job.id}:`, err);
        }
    }

    // 2.5. Release matured withdrawal holds (WITHDRAWAL_HOLD_BUSINESS_DAYS, default 3 business days)
    const holdBusinessDays = Math.max(1, parseInt(process.env.WITHDRAWAL_HOLD_BUSINESS_DAYS || '3', 10) || 3);
    const heldEarnings = await db
        .selectFrom('earnings')
        .select(['id', 'freelancerId', 'jobId', 'amount', 'description', 'createdAt'])
        .where('status', '=', 'PENDING')
        .orderBy('createdAt', 'asc')
        .limit(200)
        .execute();

    for (const earning of heldEarnings) {
        const releaseAt = addBusinessDays(new Date(earning.createdAt), holdBusinessDays);
        if (releaseAt.getTime() > now.getTime()) continue;

        try {
            await db.transaction().execute(async (trx) => {
                const locked = await trx
                    .selectFrom('earnings')
                    .select(['status'])
                    .where('id', '=', earning.id)
                    .forUpdate()
                    .executeTakeFirst();

                if (!locked || locked.status !== 'PENDING') {
                    return; // Already released by a concurrent request
                }

                const freelancer = await trx
                    .selectFrom('freelancers')
                    .select(['id', 'userId', 'withdrawableAmount'])
                    .where('id', '=', earning.freelancerId)
                    .executeTakeFirst();

                if (!freelancer) return;

                const currentBalance = parseFloat(freelancer.withdrawableAmount?.toString() || '0');
                const releaseAmount = parseFloat(earning.amount);

                await trx
                    .updateTable('earnings')
                    .set({ status: 'APPROVED', updatedAt: new Date() })
                    .where('id', '=', earning.id)
                    .execute();

                await trx
                    .updateTable('freelancers')
                    .set({
                        withdrawableAmount: (currentBalance + releaseAmount).toString(),
                        updatedAt: new Date()
                    })
                    .where('id', '=', earning.freelancerId)
                    .execute();

                // Job may have been hard-deleted after the earning was held;
                // walletTransactions.jobId is nullable, keep the release audit row.
                const jobStillExists = earning.jobId
                    ? await trx
                        .selectFrom('jobs')
                        .select('id')
                        .where('id', '=', earning.jobId)
                        .executeTakeFirst()
                    : undefined;

                await trx
                    .insertInto('walletTransactions')
                    .values({
                        id: crypto.randomUUID(),
                        userId: freelancer.userId,
                        userType: 'FREELANCER',
                        jobId: jobStillExists ? earning.jobId : null,
                        transactionType: 'HOLD_RELEASE',
                        amount: releaseAmount.toString(),
                        balanceBefore: currentBalance.toString(),
                        balanceAfter: (currentBalance + releaseAmount).toString(),
                        description: `Withdrawal hold released${earning.description ? ` — ${earning.description}` : ''}`,
                        createdAt: new Date(),
                        updatedAt: new Date()
                    })
                    .execute();
            });
        } catch (err) {
            console.error(`Failed to release held earning ${earning.id}:`, err);
        }
    }

    // On-site freelancer must arrive and verify OTP within this window of booking confirmation
    const ARRIVAL_WINDOW_HOURS = Math.max(1, parseInt(process.env.ONSITE_ARRIVAL_WINDOW_HOURS || '24', 10) || 24);
    const arrivalCutoff = new Date(now.getTime() - ARRIVAL_WINDOW_HOURS * 60 * 60 * 1000);

    // 3. Work Deadline Missed handling (12-hour grace period for remote / Auto-cancel for On-site NO-SHOW)
    const missedDeadlineJobs = await db
        .selectFrom('jobs')
        .innerJoin('clients', 'clients.id', 'jobs.clientId')
        .select([
            'jobs.id as id',
            'jobs.jobTitle as jobTitle',
            'jobs.assignedFreelancerId as assignedFreelancerId',
            'jobs.clientId as clientId',
            'jobs.freelancerGracePeriodExpiresAt as freelancerGracePeriodExpiresAt',
            'jobs.workDeadline as workDeadline',
            'jobs.budgetAmount as budgetAmount',
            'jobs.negotiatedAmount as negotiatedAmount',
            'jobs.isAmountReserved as isAmountReserved',
            'jobs.paymentMethod as paymentMethod',
            'jobs.projectType as projectType',
            'jobs.location as location',
            'jobs.otpVerifiedAt as otpVerifiedAt',
            'jobs.confirmedAt as confirmedAt',
            'clients.userId as clientUserId',
        ])
        .where('jobStatus', 'in', ['CONFIRMED', 'FREELANCER_TRAVELLING', 'ARRIVED', 'REVISION_REQUESTED', 'IN_PROGRESS', 'JOB_STARTED'])
        .where((eb) => eb.or([
            eb('workDeadline', '<=', now),
            // On-site bookings still waiting for the freelancer to arrive: due after the arrival window
            eb.and([eb('confirmedAt', '<=', arrivalCutoff), eb('otpVerifiedAt', 'is', null)]),
        ]))
        .execute();

    for (const job of missedDeadlineJobs) {
        try {
            await db.transaction().execute(async (trx) => {
                const currentJob = await trx
                    .selectFrom('jobs')
                    .select('jobStatus')
                    .where('id', '=', job.id)
                    .forUpdate()
                    .executeTakeFirst();

                if (!currentJob || !['CONFIRMED', 'FREELANCER_TRAVELLING', 'ARRIVED', 'REVISION_REQUESTED', 'IN_PROGRESS', 'JOB_STARTED'].includes(currentJob.jobStatus)) {
                    return; // Already processed by a concurrent request
                }

                const isOnSite = isOnSiteJob(job);

                // Before arrival, an on-site booking is due when the arrival window has passed (not the work deadline)
                const confirmedAtMs = job.confirmedAt ? new Date(job.confirmedAt).getTime() : 0;
                const awaitingArrival = isOnSite && !job.otpVerifiedAt && ['CONFIRMED', 'FREELANCER_TRAVELLING'].includes(currentJob.jobStatus);
                const isDue = awaitingArrival
                    ? confirmedAtMs > 0 && confirmedAtMs <= arrivalCutoff.getTime()
                    : job.workDeadline ? new Date(job.workDeadline).getTime() <= now.getTime() : false;
                if (!isDue) return;

                // On-site work past its deadline that is either awaiting OTP (ARRIVED) or already under way (JOB_STARTED)
                // is not a plain no-show: the freelancer was there and the job has started. Route it to a dispute
                // instead of auto-penalising or auto-refunding (after OTP, only a dispute can end the booking).
                // A revision that was not resubmitted in time is also routed to dispute (the work already exists).
                if (currentJob.jobStatus === 'ARRIVED' || currentJob.jobStatus === 'REVISION_REQUESTED' || (isOnSite && currentJob.jobStatus === 'JOB_STARTED')) {
                    await trx
                        .updateTable('jobs')
                        .set({
                            jobStatus: 'DISPUTE_OPEN',
                            cancellationReason: 'DISPUTE: Work deadline reached before the work was accepted',
                            updatedAt: now,
                        })
                        .where('id', '=', job.id)
                        .execute();

                    await recordJobStatusHistory(
                        trx,
                        job.id,
                        'DISPUTE_OPEN',
                        undefined,
                        'SYSTEM',
                        'ONSITE_DEADLINE_DISPUTE',
                        `Deadline reached while the booking was in status ${currentJob.jobStatus}. Routed to dispute; no automatic penalty or refund.`
                    );

                    const assignedFreelancer = job.assignedFreelancerId
                        ? await trx
                            .selectFrom('freelancers')
                            .select('userId')
                            .where('id', '=', job.assignedFreelancerId)
                            .executeTakeFirst()
                        : undefined;

                    sendNotification(
                        job.clientUserId,
                        'CLIENT',
                        'Booking Under Dispute',
                        `The deadline for "${job.jobTitle}" passed before the work was accepted. The booking is under review; no automatic penalty or refund was applied.`,
                        'DISPUTE_OPENED',
                        { jobId: job.id }
                    );
                    if (assignedFreelancer) {
                        sendNotification(
                            assignedFreelancer.userId,
                            'FREELANCER',
                            'Booking Under Dispute',
                            `The deadline for "${job.jobTitle}" passed before the work was accepted. The booking is under review; no automatic penalty was applied.`,
                            'DISPUTE_OPENED',
                            { jobId: job.id }
                        );
                    }
                    return;
                }

                const cashBooking = job.paymentMethod === 'CASH';
                const refundChat = cashBooking ? 'No payment was held for this cash booking, so no refund was needed.' : 'Full 100% refund issued to client.';
                const refundClient = cashBooking ? 'No payment was held for this cash booking, so there was nothing to refund.' : '100% full refund issued to your account.';
                const isNoShow = isOnSite && !job.otpVerifiedAt;

                if (isNoShow) {
                    // On-site Freelancer No-Show: Auto-cancel booking immediately (No 12h grace period)
                    if (job.paymentMethod === 'PLATFORM' || job.isAmountReserved) {
                        await releaseReservedAmountInTransaction(trx, job.clientUserId, job.id);
                    }

                    const effectiveAmount = job.negotiatedAmount ? parseFloat(job.negotiatedAmount.toString()) : parseFloat(job.budgetAmount.toString());
                    const penaltyAmount = effectiveAmount * 0.02;

                    // Deduct 2% penalty, add 1 strike, add 1-day cooldown to freelancer
                    if (job.assignedFreelancerId) {
                        const freelancer = await trx
                            .selectFrom('freelancers')
                            .select(['id', 'userId', 'withdrawableAmount'])
                            .where('id', '=', job.assignedFreelancerId)
                            .executeTakeFirst();

                        if (freelancer) {
                            const currentBalance = parseFloat(freelancer.withdrawableAmount?.toString() || '0');
                            // The penalty stays owed: a negative balance blocks new applications until it is settled
                            const deductedPenalty = penaltyAmount;
                            const newBalance = currentBalance - deductedPenalty;
                            const cooldownExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 1-Day Cooldown

                            await trx
                                .updateTable('freelancers')
                                .set((eb) => ({
                                    withdrawableAmount: newBalance.toString(),
                                    totalPenaltyDeducted: eb('totalPenaltyDeducted', '+', deductedPenalty.toString()),
                                    cancellationStrikes: eb('cancellationStrikes', '+', 1),
                                    cooldownExpiresAt: cooldownExpiry,
                                    updatedAt: now,
                                }))
                                .where('id', '=', freelancer.id)
                                .execute();

                            await trx.insertInto('penaltyLogs').values({
                                id: crypto.randomUUID(),
                                jobId: job.id,
                                clientId: job.clientId,
                                freelancerId: freelancer.id,
                                penaltyType: 'FREELANCER_NON_COMPLETION',
                                amount: deductedPenalty.toString(),
                                status: 'DEDUCTED',
                                description: `On-site freelancer no-show: Failed to verify OTP / arrive for "${job.jobTitle}" before deadline. 2% penalty, 1-day cooldown, 1 cancellation strike applied.`,
                                createdAt: now,
                                updatedAt: now,
                            }).execute();

                            // Record wallet transaction history entry for penalty deduction
                            await trx.insertInto('walletTransactions').values({
                                id: crypto.randomUUID(),
                                userId: freelancer.userId,
                                userType: 'FREELANCER',
                                jobId: job.id,
                                transactionType: 'PENALTY',
                                amount: (-deductedPenalty).toString(),
                                balanceBefore: currentBalance.toString(),
                                balanceAfter: newBalance.toString(),
                                description: `No-show 2% penalty deducted to BirdEarner - ${job.jobTitle}`,
                                createdAt: now,
                                updatedAt: now
                            }).execute();

                            sendNotification(
                                freelancer.userId,
                                'FREELANCER',
                                'Booking Cancelled - No-Show Penalty Deducted',
                                `Job "${job.jobTitle}" was auto-cancelled due to no-show before deadline. 2% penalty (₹${penaltyAmount.toFixed(2)}) deducted from your wallet, 1-day cooldown applied.`,
                                'JOB_CANCELLED',
                                { jobId: job.id }
                            );
                        }
                    }

                    await trx
                        .updateTable('jobs')
                        .set({
                            jobStatus: 'CANCELLED',
                            cancelledAt: now,
                            cancellationReason: 'FREELANCER NO-SHOW / FAILED TO COMPLETE',
                            paymentStatus: 'REFUNDED',
                            updatedAt: now,
                        })
                        .where('id', '=', job.id)
                        .execute();

                    // Close any active completion_request messages in chat for this job
                    const thread = await trx
                        .selectFrom('chatThreads')
                        .select('id')
                        .where('jobId', '=', job.id)
                        .executeTakeFirst();

                    if (thread) {
                        await trx
                            .updateTable('messages')
                            .set({
                                messageData: sql`jsonb_set("messageData"::jsonb, '{status}', '"closed"'::jsonb)`,
                                updatedAt: now
                            } as any)
                            .where('chatThreadId', '=', thread.id)
                            .where('messageType', '=', 'completion_request')
                            .execute();

                        // Insert system notification message in chat
                        await trx
                            .insertInto('messages')
                            .values({
                                id: crypto.randomUUID(),
                                chatThreadId: thread.id,
                                senderId: job.clientUserId,
                                receiverId: job.clientUserId,
                                messageContent: `⚠️ BOOKING AUTO-CANCELLED: Freelancer failed to arrive on-site and verify OTP before deadline. Reason: FREELANCER NO-SHOW / FAILED TO COMPLETE. ${refundChat} 2% penalty (₹${penaltyAmount.toFixed(2)}) deducted from freelancer.`,
                                messageType: 'notification',
                                senderType: 'SYSTEM',
                                createdAt: now,
                                updatedAt: now
                            })
                            .execute();
                    }

                    await recordJobStatusHistory(
                        trx,
                        job.id,
                        'CANCELLED',
                        undefined,
                        'SYSTEM',
                        'FREELANCER_NO_SHOW',
                        'On-site freelancer no-show: Failed to verify OTP before deadline. Auto-cancelled booking with 2% penalty, 1-day cooldown, 1 strike to freelancer.'
                    );

                    sendNotification(
                        job.clientUserId,
                        'CLIENT',
                        'Booking Auto-Cancelled (Freelancer No-Show)',
                        `Job "${job.jobTitle}" was auto-cancelled because the freelancer failed to arrive and verify OTP. ${refundClient}`,
                        'JOB_CANCELLED',
                        { jobId: job.id }
                    );
                } else if (isOnSite || (job.freelancerGracePeriodExpiresAt && job.freelancerGracePeriodExpiresAt <= now)) {
                    // Grace period expired (or On-site job deadline expired) -> DEADLINE_EXPIRED / BOOKING_FAILED
                    if (job.isAmountReserved) {
                        await releaseReservedAmountInTransaction(trx, job.clientUserId, job.id);
                    }

                    const effectiveAmount = job.negotiatedAmount ? parseFloat(job.negotiatedAmount.toString()) : parseFloat(job.budgetAmount.toString());
                    const penaltyAmount = effectiveAmount * 0.02;

                    // Deduct 2% penalty from freelancer if assigned
                    if (job.assignedFreelancerId) {
                        const freelancer = await trx
                            .selectFrom('freelancers')
                            .select(['id', 'userId', 'withdrawableAmount'])
                            .where('id', '=', job.assignedFreelancerId)
                            .executeTakeFirst();

                        if (freelancer) {
                            const currentBalance = parseFloat(freelancer.withdrawableAmount?.toString() || '0');
                            // The penalty stays owed: a negative balance blocks new applications until it is settled
                            const deductedPenalty = penaltyAmount;
                            const newBalance = currentBalance - deductedPenalty;

                            const cooldownExpiry = new Date(now.getTime() + 24 * 60 * 60 * 1000);

                            await trx
                                .updateTable('freelancers')
                                .set((eb) => ({
                                    withdrawableAmount: newBalance.toString(),
                                    totalPenaltyDeducted: eb('totalPenaltyDeducted', '+', deductedPenalty.toString()),
                                    cancellationStrikes: eb('cancellationStrikes', '+', 1),
                                    cooldownExpiresAt: cooldownExpiry,
                                    updatedAt: now,
                                }))
                                .where('id', '=', freelancer.id)
                                .execute();

                            await trx.insertInto('penaltyLogs').values({
                                id: crypto.randomUUID(),
                                jobId: job.id,
                                clientId: job.clientId,
                                freelancerId: freelancer.id,
                                penaltyType: 'FREELANCER_NON_COMPLETION',
                                amount: deductedPenalty.toString(),
                                status: 'DEDUCTED',
                                description: isOnSite
                                    ? `On-site work deadline expired for "${job.jobTitle}". 2% penalty deducted.`
                                    : `Freelancer failed to submit work by deadline + 12h grace period for "${job.jobTitle}". 2% penalty deducted.`,
                                createdAt: now,
                                updatedAt: now,
                            }).execute();

                            // Record wallet transaction history entry for penalty deduction
                            await trx.insertInto('walletTransactions').values({
                                id: crypto.randomUUID(),
                                userId: freelancer.userId,
                                userType: 'FREELANCER',
                                jobId: job.id,
                                transactionType: 'PENALTY',
                                amount: (-deductedPenalty).toString(),
                                balanceBefore: currentBalance.toString(),
                                balanceAfter: newBalance.toString(),
                                description: `Deadline expired 2% penalty deducted to BirdEarner - ${job.jobTitle}`,
                                createdAt: now,
                                updatedAt: now
                            }).execute();
                        }
                    }

                    await trx
                        .updateTable('jobs')
                        .set({
                            jobStatus: 'DEADLINE_EXPIRED',
                            paymentStatus: 'REFUNDED',
                            updatedAt: now,
                        })
                        .where('id', '=', job.id)
                        .execute();

                    // Close any active completion_request messages in chat for this job
                    const thread = await trx
                        .selectFrom('chatThreads')
                        .select('id')
                        .where('jobId', '=', job.id)
                        .executeTakeFirst();

                    if (thread) {
                        await trx
                            .updateTable('messages')
                            .set({
                                messageData: sql`jsonb_set("messageData"::jsonb, '{status}', '"closed"'::jsonb)`,
                                updatedAt: now
                            } as any)
                            .where('chatThreadId', '=', thread.id)
                            .where('messageType', '=', 'completion_request')
                            .execute();

                        // Insert system notification message in chat
                        await trx
                            .insertInto('messages')
                            .values({
                                id: crypto.randomUUID(),
                                chatThreadId: thread.id,
                                senderId: job.clientUserId,
                                receiverId: job.clientUserId,
                                messageContent: isOnSite
                                    ? `⚠️ BOOKING AUTO-CANCELLED: On-site work deadline expired. Reason: FREELANCER NON-COMPLETION. ${refundChat} 2% penalty (₹${penaltyAmount.toFixed(2)}) deducted from freelancer.`
                                    : `⚠️ BOOKING AUTO-CANCELLED: Freelancer failed to submit work after deadline and 12-hour grace period. ${refundChat} 2% penalty (₹${penaltyAmount.toFixed(2)}) deducted from freelancer.`,
                                messageType: 'notification',
                                senderType: 'SYSTEM',
                                createdAt: now,
                                updatedAt: now
                            })
                            .execute();
                    }

                    await recordJobStatusHistory(
                        trx,
                        job.id,
                        'DEADLINE_EXPIRED',
                        undefined,
                        'SYSTEM',
                        'FREELANCER_NON_COMPLETION',
                        isOnSite
                            ? 'On-site work deadline expired without completion'
                            : 'Freelancer failed to submit work after deadline and 12-hour grace period'
                    );

                    sendNotification(
                        job.clientUserId,
                        'CLIENT',
                        'Booking Cancelled - Freelancer Non-Completion',
                        `Job "${job.jobTitle}" was cancelled because the work deadline expired. ${refundClient}`,
                        'JOB_CANCELLED',
                        { jobId: job.id }
                    );
                } else if (!job.freelancerGracePeriodExpiresAt) {
                    // Set 12h final grace period ONLY for remote jobs
                    // Final 12h grace runs from the deadline itself (PDF Case 5), not from when the timer first noticed it
const graceExpiry = new Date(new Date(job.workDeadline ?? now).getTime() + 12 * 60 * 60 * 1000);
                    await trx
                        .updateTable('jobs')
                        .set({ freelancerGracePeriodExpiresAt: graceExpiry, updatedAt: now })
                        .where('id', '=', job.id)
                        .execute();

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
                                'Deadline Expired - 12h Grace Period',
                                `Your deadline for "${job.jobTitle}" has expired. You have 12 hours remaining to submit agreed work.`,
                                'DEADLINE_WARNING',
                                { jobId: job.id }
                            );
                        }
                    }
                }
            });
        } catch (err) {
            console.error(`Failed to process missed deadline for job ${job.id}:`, err);
        }
    }
}

