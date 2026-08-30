import { db } from '../db';
import { processJobPaymentInTransaction, releaseReservedAmountInTransaction } from './wallet';
import { sendNotification } from './notifications';

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
 * Process automatic job timers (Application deadline, 12h review auto-accept, 12h work deadline grace period)
 */
export async function processJobTimers() {
    const now = new Date();

    // 1. Expire OPEN jobs where applicationDeadline <= now
    const expiredJobs = await db
        .selectFrom('jobs')
        .select(['id', 'clientId', 'jobTitle'])
        .where('jobStatus', '=', 'OPEN')
        .where('applicationDeadline', '<=', now)
        .execute();

    for (const job of expiredJobs) {
        try {
            await db.transaction().execute(async (trx) => {
                await trx
                    .updateTable('jobs')
                    .set({ jobStatus: 'EXPIRED', updatedAt: now })
                    .where('id', '=', job.id)
                    .execute();

                await recordJobStatusHistory(
                    trx,
                    job.id,
                    'EXPIRED',
                    undefined,
                    'SYSTEM',
                    'APPLICATION_DEADLINE_EXPIRED',
                    'No freelancer was confirmed before application deadline expired'
                );

                const client = await trx
                    .selectFrom('clients')
                    .select('userId')
                    .where('id', '=', job.clientId)
                    .executeTakeFirst();

                if (client) {
                    sendNotification(
                        client.userId,
                        'CLIENT',
                        'Application Deadline Expired',
                        `Your job "${job.jobTitle}" application deadline has expired. No freelancer was confirmed. You can extend the deadline or post a new job.`,
                        'JOB_EXPIRED',
                        { jobId: job.id }
                    );
                }
            });
        } catch (err) {
            console.error(`Failed to process expired job ${job.id}:`, err);
        }
    }

    // 2. Auto-accept WORK_SUBMITTED jobs where clientReviewPeriodExpiresAt <= now
    const autoAcceptJobs = await db
        .selectFrom('jobs')
        .select(['id', 'jobTitle', 'assignedFreelancerId', 'clientId', 'budgetAmount'])
        .where('jobStatus', '=', 'WORK_SUBMITTED')
        .where('clientReviewPeriodExpiresAt', '<=', now)
        .execute();

    for (const job of autoAcceptJobs) {
        try {
            await db.transaction().execute(async (trx) => {
                await processJobPaymentInTransaction(trx, job.id);

                await trx
                    .updateTable('jobs')
                    .set({
                        jobStatus: 'AUTO_ACCEPTED',
                        completedAt: now,
                        paymentStatus: 'COMPLETED',
                        amountPaid: job.budgetAmount,
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

    // 3. Work Deadline Missed handling (12-hour grace period)
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
            'clients.userId as clientUserId',
        ])
        .where('jobStatus', 'in', ['CONFIRMED', 'IN_PROGRESS', 'JOB_STARTED'])
        .where('workDeadline', '<=', now)
        .execute();

    for (const job of missedDeadlineJobs) {
        try {
            await db.transaction().execute(async (trx) => {
                if (!job.freelancerGracePeriodExpiresAt) {
                    // Set 12h final grace period
                    const graceExpiry = new Date(now.getTime() + 12 * 60 * 60 * 1000);
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
                } else if (job.freelancerGracePeriodExpiresAt <= now) {
                    // Grace period expired -> DEADLINE_EXPIRED / BOOKING_FAILED
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
                            const newBalance = currentBalance - penaltyAmount;

                            await trx
                                .updateTable('freelancers')
                                .set((eb) => ({
                                    withdrawableAmount: newBalance.toString(),
                                    totalPenaltyDeducted: eb('totalPenaltyDeducted', '+', penaltyAmount.toString()),
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
                                amount: penaltyAmount.toString(),
                                status: 'DEDUCTED',
                                description: `Freelancer failed to submit work by deadline + 12h grace period for "${job.jobTitle}". 2% penalty deducted.`,
                                createdAt: now,
                                updatedAt: now,
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

                    await recordJobStatusHistory(
                        trx,
                        job.id,
                        'DEADLINE_EXPIRED',
                        undefined,
                        'SYSTEM',
                        'FREELANCER_NON_COMPLETION',
                        'Freelancer failed to submit work after deadline and 12-hour grace period'
                    );

                    sendNotification(
                        job.clientUserId,
                        'CLIENT',
                        'Booking Cancelled - Freelancer Non-Completion',
                        `Job "${job.jobTitle}" was cancelled because the freelancer failed to submit work. 100% full refund issued to your account.`,
                        'JOB_CANCELLED',
                        { jobId: job.id }
                    );
                }
            });
        } catch (err) {
            console.error(`Failed to process missed deadline for job ${job.id}:`, err);
        }
    }
}
