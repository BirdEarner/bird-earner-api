import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { sendNotification } from '@/lib/services/notifications';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';
import { JobStatus } from '@/types/types';

const updateStatusSchema = z.object({
    status: z.nativeEnum(JobStatus),
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

        const { status } = validation.data;

        const job = await db
            .updateTable('jobs')
            .set({ jobStatus: status, updatedAt: new Date() })
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirstOrThrow();

        // Notification Logic (Simplified from server)
        const jobDetails = await db
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
            .select([
                'jobs.jobTitle',
                'clients.userId as clientUserId',
                'freelancers.userId as freelancerUserId'
            ])
            .where('jobs.id', '=', id)
            .executeTakeFirst();

        if (jobDetails) {
            if (status === 'COMPLETED' && jobDetails.clientUserId) {
                sendNotification(jobDetails.clientUserId, 'CLIENT', 'Job Completed', `Job "${jobDetails.jobTitle}" has been marked as completed.`, 'JOB_COMPLETED', { jobId: id });
            }
            if (jobDetails.freelancerUserId) {
                sendNotification(jobDetails.freelancerUserId, 'FREELANCER', 'Job Status Update', `Job "${jobDetails.jobTitle}" status is now: ${status}`, 'JOB_UPDATE', { jobId: id });
            }
        }

        return NextResponse.json({
            success: true,
            message: 'Job status updated successfully',
            data: job
        });
    } catch (error: any) {
        console.error('Update job status error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Failed to update status'
        }, { status: 500 });
    }
}
