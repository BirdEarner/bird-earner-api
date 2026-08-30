import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { sendNotification } from '@/lib/services/notifications';
import { recordJobStatusHistory } from '@/lib/services/timers';
import { isValidStatusTransition } from '@/lib/services/jobs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const updateStatusSchema = z.object({
    status: z.string().min(1),
    reason: z.string().optional(),
});

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), updateStatusSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { status: newStatus, reason } = validation.data;

        // Fetch job with authorization info
        const job = await db
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
            .select([
                'jobs.id',
                'jobs.jobStatus',
                'jobs.clientId',
                'jobs.assignedFreelancerId',
                'jobs.deleted',
                'clients.userId as clientUserId',
                'freelancers.userId as freelancerUserId',
            ])
            .where('jobs.id', '=', id)
            .executeTakeFirst();

        if (!job || job.deleted) {
            return NextResponse.json({ message: 'Job not found' }, { status: 404 });
        }

        // Authorization: client, assigned freelancer, or admin
        const isClient = job.clientUserId === user.id;
        const isFreelancer = job.freelancerUserId === user.id;
        const isAdmin = user.role === 'admin' || user.role === 'superadmin';

        if (!isClient && !isFreelancer && !isAdmin) {
            return NextResponse.json({ message: 'Unauthorized to change this job status' }, { status: 403 });
        }

        // Validate status transition
        if (!isValidStatusTransition(job.jobStatus, newStatus)) {
            return NextResponse.json({
                message: `Invalid status transition from ${job.jobStatus} to ${newStatus}`
            }, { status: 400 });
        }

        // Update status
        const updatedJob = await db
            .updateTable('jobs')
            .set({ jobStatus: newStatus as any, updatedAt: new Date() })
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirstOrThrow();

        // Record audit trail
        await db.transaction().execute(async (trx) => {
            await recordJobStatusHistory(
                trx,
                id,
                newStatus,
                user.id,
                isClient ? 'CLIENT' : 'FREELANCER',
                'MANUAL_STATUS_UPDATE',
                reason || `Status changed from ${job.jobStatus} to ${newStatus}`,
                { previousStatus: job.jobStatus }
            );
        });

        // Notification Logic
        const jobDetails = await db
            .selectFrom('jobs')
            .select(['jobs.jobTitle'])
            .where('jobs.id', '=', id)
            .executeTakeFirst();

        if (jobDetails) {
            if (newStatus === 'COMPLETED' && job.clientUserId) {
                sendNotification(job.clientUserId, 'CLIENT', 'Job Completed', `Job "${jobDetails.jobTitle}" has been marked as completed.`, 'JOB_COMPLETED', { jobId: id });
            }
            if (job.freelancerUserId) {
                sendNotification(job.freelancerUserId, 'FREELANCER', 'Job Status Update', `Job "${jobDetails.jobTitle}" status is now: ${newStatus}`, 'JOB_UPDATE', { jobId: id });
            }
        }

        return NextResponse.json({
            success: true,
            message: 'Job status updated successfully',
            data: updatedJob
        });
    } catch (error: any) {
        console.error('Update job status error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Failed to update status'
        }, { status: 500 });
    }
}
