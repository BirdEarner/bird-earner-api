import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { TERMINAL_JOB_STATUSES, hasFreelancerCompletionRequest } from '@/lib/services/jobs';
import { isOnSiteJob } from '@/lib/job-type';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const completeCashSchema = z.object({
    userRole: z.string().optional(),
    threadId: z.string(),
    // Ignored: the amount is always derived from the job, never trusted from the request
    budgetAmount: z.union([z.number(), z.string()]).optional(),
});

export async function POST(
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
        const validation = await validateParams(Promise.resolve(body), completeCashSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { userRole, threadId } = validation.data;

        const job = await db
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
            .select([
                'jobs.id',
                'jobs.paymentMethod',
                'jobs.jobStatus',
                'jobs.projectType',
                'jobs.location',
                'jobs.otpVerifiedAt',
                'jobs.budgetAmount',
                'jobs.negotiatedAmount',
                'clients.userId as clientUserId',
                'freelancers.userId as freelancerUserId'
            ])
            .where('jobs.id', '=', id)
            .where('jobs.deleted', '=', false)
            .executeTakeFirst();

        if (!job) {
            return NextResponse.json({ success: false, message: 'Job not found' }, { status: 404 });
        }

        // Only the client or the assigned freelancer of this job can start the cash settlement
        if (user.id !== job.clientUserId && user.id !== job.freelancerUserId) {
            return NextResponse.json({ success: false, message: 'Unauthorized - you are not a party to this job' }, { status: 403 });
        }

        if (job.paymentMethod !== 'CASH') {
            return NextResponse.json({ success: false, message: 'Only for cash payments' }, { status: 400 });
        }

        if (!isOnSiteJob(job)) {
            return NextResponse.json({ success: false, message: 'Cash settlement is only available for on-site jobs' }, { status: 400 });
        }

        if (TERMINAL_JOB_STATUSES.includes(job.jobStatus)) {
            return NextResponse.json({ success: false, message: 'This job is no longer active' }, { status: 400 });
        }

        // On-site jobs require OTP verification before the work can be confirmed
        const isOnSite = isOnSiteJob(job);
        if (isOnSite && !job.otpVerifiedAt) {
            return NextResponse.json({ success: false, message: 'OTP verification pending. Please wait for the on-site attendance flow to complete.' }, { status: 400 });
        }

        // The thread must be a chat for this job
        const thread = await db
            .selectFrom('chatThreads')
            .select('id')
            .where('id', '=', threadId)
            .where('jobId', '=', id)
            .executeTakeFirst();

        if (!thread) {
            return NextResponse.json({ success: false, message: 'Chat thread does not belong to this job' }, { status: 400 });
        }

        // Order: the freelancer marks the work completed first; the client then starts the cash settlement
        if (user.id !== job.freelancerUserId && !(await hasFreelancerCompletionRequest(db, id))) {
            return NextResponse.json({ success: false, message: 'The freelancer must mark the work as completed first' }, { status: 400 });
        }

        // Check if cash payment message already exists for this thread
        const existingPaymentMessage = await db
            .selectFrom('messages')
            .selectAll()
            .where('chatThreadId', '=', threadId)
            .where('messageType', '=', 'cash_payment')
            .executeTakeFirst();

        if (existingPaymentMessage) {
            return NextResponse.json({
                success: true,
                message: 'Cash payment flow already initiated',
                data: existingPaymentMessage
            });
        }

        let receiverId;
        if (user.id === job.freelancerUserId) {
            receiverId = job.clientUserId;
        } else {
            receiverId = job.freelancerUserId;
        }

        if (!receiverId) {
            return NextResponse.json({ success: false, message: 'Receiver not found' }, { status: 400 });
        }

        const amount = job.negotiatedAmount
            ? parseFloat(job.negotiatedAmount.toString())
            : parseFloat(job.budgetAmount.toString());

        const paymentMessage = await db
            .insertInto('messages')
            .values({
                id: crypto.randomUUID(),
                chatThreadId: threadId,
                senderId: user.id,
                receiverId: receiverId,
                messageContent: 'Project completion and cash payment required',
                messageType: 'cash_payment',
                senderType: userRole ? userRole.toUpperCase() : 'CLIENT',
                    messageData: {
                        amount,
                        step: 'initial',
                        clientConfirmed: false,
                        freelancerConfirmed: false,
                        jobId: id
                    },
                createdAt: new Date(),
                updatedAt: new Date()
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        return NextResponse.json({
            success: true,
            message: 'Cash payment flow initiated',
            data: paymentMessage
        });
    } catch (error: any) {
        console.error('Complete cash error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
