import { db } from '../db';
import { calculateBirdFee } from '../utils/fee';
import { reserveAmountForJobInTransaction, processJobPaymentInTransaction, releaseReservedAmountInTransaction } from './wallet';
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
                jobStatus: 'OPEN',
                paymentStatus: 'PENDING',
                isAmountReserved: false,
                updatedAt: new Date()
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        // 3. Handle Platform Payment Reservation
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
 * Assign a freelancer to a job
 */
export async function assignFreelancer(jobId: string, freelancerId: string, clientUserId: string) {
    return await db.transaction().execute(async (trx) => {
        const job = await trx
            .selectFrom('jobs')
            .select(['id', 'budgetAmount', 'paymentMethod', 'isAmountReserved', 'jobTitle'])
            .where('id', '=', jobId)
            .executeTakeFirst();

        if (!job) throw new Error('Job not found');

        // 1. If not already reserved (e.g. was CASH originally or failed), try to reserve now for PLATFORM
        if (!job.isAmountReserved && job.paymentMethod === 'PLATFORM') {
            await reserveAmountForJobInTransaction(trx, clientUserId, jobId, parseFloat(job.budgetAmount));
        }

        // 2. Update job assignment
        const updatedJob = await trx
            .updateTable('jobs')
            .set({
                assignedFreelancerId: freelancerId,
                jobStatus: 'IN_PROGRESS',
                assignedAt: new Date(),
                updatedAt: new Date()
            })
            .where('id', '=', jobId)
            .returningAll()
            .executeTakeFirstOrThrow();

        // 3. Update related chat threads (if any exist at this point)
        await trx
            .updateTable('chatThreads')
            .set({ status: 'ACCEPTED', updatedAt: new Date() })
            .where('jobId', '=', jobId)
            .where('freelancerId', '=', freelancerId)
            .execute();

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

        return updatedJob;
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
export async function cancelJob(jobId: string, userId: string) {
    return await db.transaction().execute(async (trx) => {
        const job = await trx
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
            .select([
                'jobs.id',
                'jobs.isAmountReserved',
                'clients.userId as clientUserId',
                'freelancers.userId as freelancerUserId'
            ])
            .where('jobs.id', '=', jobId)
            .executeTakeFirst();

        if (!job) throw new Error('Job not found');

        // Auth check
        if (job.clientUserId !== userId && job.freelancerUserId !== userId) {
            throw new Error('Unauthorized');
        }

        // 1. Release Funds if reserved
        if (job.isAmountReserved) {
            await releaseReservedAmountInTransaction(trx, job.clientUserId, jobId);
        }

        // 2. Update status
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

        return cancelledJob;
    });
}
