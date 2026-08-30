import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { sendNotification } from '@/lib/services/notifications';
import { recordJobStatusHistory } from '@/lib/services/timers';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const resolveDisputeSchema = z.object({
    action: z.enum(['REFUND_CLIENT', 'PAY_FREELANCER', 'CLOSE_DISPUTE']),
    resolutionNotes: z.string().min(1, 'Resolution notes are required'),
});

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const admin = await getAdminUser(request);
        if (!admin) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const body = await request.json();
        const validation = resolveDisputeSchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error.errors[0]?.message || 'Invalid input' }, { status: 400 });
        }

        const { action, resolutionNotes } = validation.data;

        // Fetch target job
        const job = await db
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .innerJoin('users as clientUser', 'clientUser.id', 'clients.userId')
            .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
            .leftJoin('users as freelancerUser', 'freelancerUser.id', 'freelancers.userId')
            .select([
                'jobs.id',
                'jobs.jobTitle',
                'jobs.jobStatus',
                'jobs.budgetAmount',
                'jobs.birdFeeAmount',
                'jobs.paymentMethod',
                'jobs.clientId',
                'jobs.assignedFreelancerId',
                'clientUser.id as clientUserId',
                'freelancerUser.id as freelancerUserId',
            ])
            .where('jobs.id', '=', id)
            .executeTakeFirst();

        if (!job) {
            return NextResponse.json({ message: 'Job not found' }, { status: 404 });
        }

        const budget = parseFloat(job.budgetAmount?.toString() || '0');
        const birdFeeAmount = parseFloat(job.birdFeeAmount?.toString() || '0');
        const isCashJob = job.paymentMethod === 'CASH' || !job.paymentMethod;
        const now = new Date();

        const updatedJob = await db.transaction().execute(async (trx) => {
            let targetJobStatus = 'DISPUTE_RESOLVED';
            let targetPaymentStatus = job.jobStatus;

            if (action === 'REFUND_CLIENT') {
                targetJobStatus = isCashJob ? 'CANCELLED' : 'REFUNDED';
                targetPaymentStatus = isCashJob ? 'CANCELLED' : 'REFUNDED';

                await trx
                    .updateTable('jobs')
                    .set({
                        jobStatus: targetJobStatus as any,
                        paymentStatus: targetPaymentStatus as any,
                        cancellationReason: `Dispute resolved by Admin (${admin.email}): ${isCashJob ? 'In Favor of Client (No Cash Payment Required)' : 'Refund Client'}. ${resolutionNotes}`,
                        updatedAt: now,
                    })
                    .where('id', '=', id)
                    .execute();
            } else if (action === 'PAY_FREELANCER') {
                targetJobStatus = 'DISPUTE_RESOLVED';
                targetPaymentStatus = 'COMPLETED';

                await trx
                    .updateTable('jobs')
                    .set({
                        jobStatus: 'DISPUTE_RESOLVED',
                        paymentStatus: 'COMPLETED',
                        amountPaid: job.budgetAmount,
                        updatedAt: now,
                    })
                    .where('id', '=', id)
                    .execute();

                if (isCashJob) {
                    // CASH JOB: Client pays agreed budget directly to freelancer in CASH in person.
                    // Deduct platform fee from freelancer wallet if applicable.
                    if (job.assignedFreelancerId && birdFeeAmount > 0) {
                        const freelancer = await trx
                            .selectFrom('freelancers')
                            .select(['withdrawableAmount'])
                            .where('id', '=', job.assignedFreelancerId)
                            .executeTakeFirst();

                        const currentWithdrawable = parseFloat(freelancer?.withdrawableAmount?.toString() || '0');
                        const newWithdrawable = currentWithdrawable - birdFeeAmount;

                        await trx
                            .updateTable('freelancers')
                            .set({
                                withdrawableAmount: newWithdrawable.toString(),
                                updatedAt: now,
                            })
                            .where('id', '=', job.assignedFreelancerId)
                            .execute();

                        await trx
                            .insertInto('walletTransactions')
                            .values({
                                id: crypto.randomUUID(),
                                userId: job.freelancerUserId,
                                userType: 'FREELANCER',
                                jobId: id,
                                amount: (-birdFeeAmount).toString(),
                                balanceBefore: currentWithdrawable.toString(),
                                balanceAfter: newWithdrawable.toString(),
                                transactionType: 'PLATFORM_FEE' as any,
                                description: `Platform fee for cash job dispute resolution: ${resolutionNotes}`,
                                createdAt: now,
                                updatedAt: now,
                            })
                            .execute();
                    }
                } else {
                    // ONLINE PLATFORM PAYMENT JOB: Credit freelancer wallet with held funds
                    if (job.assignedFreelancerId && budget > 0) {
                        const freelancer = await trx
                            .selectFrom('freelancers')
                            .select(['withdrawableAmount', 'totalEarnings'])
                            .where('id', '=', job.assignedFreelancerId)
                            .executeTakeFirst();

                        const currentWithdrawable = parseFloat(freelancer?.withdrawableAmount?.toString() || '0');
                        const currentTotal = parseFloat(freelancer?.totalEarnings?.toString() || '0');

                        await trx
                            .updateTable('freelancers')
                            .set({
                                withdrawableAmount: (currentWithdrawable + budget).toString(),
                                totalEarnings: (currentTotal + budget).toString(),
                                updatedAt: now,
                            })
                            .where('id', '=', job.assignedFreelancerId)
                            .execute();

                        await trx
                            .insertInto('walletTransactions')
                            .values({
                                id: crypto.randomUUID(),
                                userId: job.freelancerUserId,
                                userType: 'FREELANCER',
                                jobId: id,
                                amount: budget.toString(),
                                balanceBefore: currentWithdrawable.toString(),
                                balanceAfter: (currentWithdrawable + budget).toString(),
                                transactionType: 'JOB_RELEASE' as any,
                                description: `Payment released via dispute resolution: ${resolutionNotes}`,
                                createdAt: now,
                                updatedAt: now,
                            })
                            .execute();
                    }
                }
            } else {
                // CLOSE_DISPUTE
                await trx
                    .updateTable('jobs')
                    .set({
                        jobStatus: 'DISPUTE_RESOLVED',
                        updatedAt: now,
                    })
                    .where('id', '=', id)
                    .execute();
            }

            // Record status history
            await recordJobStatusHistory(
                trx,
                id,
                targetJobStatus,
                admin.email,
                'ADMIN',
                'ADMIN_DISPUTE_RESOLVE',
                `Resolution Action: ${action} (${isCashJob ? 'CASH' : 'ONLINE'}). Notes: ${resolutionNotes}`
            );

            return await trx
                .selectFrom('jobs')
                .select(['id', 'jobStatus', 'paymentStatus'])
                .where('id', '=', id)
                .executeTakeFirst();
        });

        // Notifications
        if (action === 'REFUND_CLIENT') {
            if (job.clientUserId) {
                sendNotification(
                    job.clientUserId,
                    'CLIENT',
                    'Dispute Resolved - In Favor of Client',
                    isCashJob
                        ? `Your dispute for job "${job.jobTitle}" has been resolved in your favor. You do not need to pay cash to the freelancer.`
                        : `Your dispute for job "${job.jobTitle}" has been resolved. A full refund of ₹${budget} has been issued.`,
                    'DISPUTE_RESOLVED',
                    { jobId: id }
                );
            }
            if (job.freelancerUserId) {
                sendNotification(
                    job.freelancerUserId,
                    'FREELANCER',
                    'Dispute Resolved - In Favor of Client',
                    isCashJob
                        ? `The dispute for job "${job.jobTitle}" was resolved by support in favor of the client. No cash payment will be collected.`
                        : `The dispute for job "${job.jobTitle}" was resolved by support with a client refund.`,
                    'DISPUTE_RESOLVED',
                    { jobId: id }
                );
            }
        } else if (action === 'PAY_FREELANCER') {
            if (isCashJob) {
                if (job.freelancerUserId) {
                    sendNotification(
                        job.freelancerUserId,
                        'FREELANCER',
                        'Dispute Resolved - Collect Cash Payment',
                        `The dispute for job "${job.jobTitle}" was resolved in your favor. Please collect ₹${budget} in CASH directly from the client.`,
                        'DISPUTE_RESOLVED',
                        { jobId: id }
                    );
                }
                if (job.clientUserId) {
                    sendNotification(
                        job.clientUserId,
                        'CLIENT',
                        'Dispute Resolved - Pay Freelancer in Cash',
                        `The dispute for job "${job.jobTitle}" was resolved in favor of the freelancer. Please pay ₹${budget} in CASH directly to the freelancer.`,
                        'DISPUTE_RESOLVED',
                        { jobId: id }
                    );
                }
            } else {
                if (job.freelancerUserId) {
                    sendNotification(
                        job.freelancerUserId,
                        'FREELANCER',
                        'Dispute Resolved - Payment Released',
                        `The dispute for job "${job.jobTitle}" was resolved in your favor. ₹${budget} has been credited to your wallet.`,
                        'DISPUTE_RESOLVED',
                        { jobId: id }
                    );
                }
                if (job.clientUserId) {
                    sendNotification(
                        job.clientUserId,
                        'CLIENT',
                        'Dispute Resolved',
                        `The dispute for job "${job.jobTitle}" has been resolved and funds released to freelancer.`,
                        'DISPUTE_RESOLVED',
                        { jobId: id }
                    );
                }
            }
        } else {
            if (job.clientUserId) {
                sendNotification(job.clientUserId, 'CLIENT', 'Dispute Closed', `The dispute for job "${job.jobTitle}" has been closed by support.`, 'DISPUTE_RESOLVED', { jobId: id });
            }
            if (job.freelancerUserId) {
                sendNotification(job.freelancerUserId, 'FREELANCER', 'Dispute Closed', `The dispute for job "${job.jobTitle}" has been closed by support.`, 'DISPUTE_RESOLVED', { jobId: id });
            }
        }

        return NextResponse.json({
            success: true,
            message: `Dispute resolved successfully with action: ${action}`,
            data: updatedJob,
        });
    } catch (error: any) {
        console.error('Resolve dispute error:', error);
        return NextResponse.json({ message: error.message || 'Server error' }, { status: 500 });
    }
}
