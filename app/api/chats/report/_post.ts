import { getAuthUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const reportSchema = z.object({
    threadId: z.string().optional(),
    jobId: z.string().optional(),
    reason: z.string().min(1, 'Reason is required'),
    reportedUserId: z.string().optional(),
    details: z.string().optional(),
});

const META_MARKER = '---REPORT_META---';

export async function POST(request: Request) {
    try {
        const authUser = await getAuthUser();
        if (!authUser) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const parsed = reportSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { success: false, message: parsed.error.issues[0]?.message || 'Invalid input' },
                { status: 400 }
            );
        }

        const { threadId, reason, reportedUserId, details } = parsed.data;
        let jobId = parsed.data.jobId || null;

        const reportingUser = await db
            .selectFrom('users')
            .select(['id', 'fullName', 'email', 'mobile'])
            .where('id', '=', authUser.id)
            .executeTakeFirst();

        let reportedUser = null as
            | { id: string; fullName: string | null; email: string; mobile: string | null }
            | null;
        if (reportedUserId) {
            reportedUser =
                (await db
                    .selectFrom('users')
                    .select(['id', 'fullName', 'email', 'mobile'])
                    .where('id', '=', reportedUserId)
                    .executeTakeFirst()) || null;
        }

        // Resolve thread → job / parties when reporting from chat
        let thread = null as Awaited<ReturnType<typeof loadThreadContext>> | null;
        if (threadId) {
            thread = await loadThreadContext(threadId);
            if (thread?.jobId) jobId = thread.jobId;
            if (!reportedUser && thread) {
                // Infer reported party as the other side of the thread
                const otherUserId =
                    thread.clientUserId === authUser.id
                        ? thread.freelancerUserId
                        : thread.freelancerUserId === authUser.id
                          ? thread.clientUserId
                          : null;
                if (otherUserId) {
                    reportedUser =
                        (await db
                            .selectFrom('users')
                            .select(['id', 'fullName', 'email', 'mobile'])
                            .where('id', '=', otherUserId)
                            .executeTakeFirst()) || null;
                }
            }
        }

        let job = null as Awaited<ReturnType<typeof loadJobSummary>> | null;
        if (jobId) {
            job = await loadJobSummary(jobId);
        }

        const reportType = threadId ? 'chat_report' : jobId ? 'job_report' : 'user_report';
        const ticketPrefix =
            reportType === 'chat_report' ? 'TKT-CHAT' : reportType === 'job_report' ? 'TKT-JOB' : 'TKT-REP';
        const ticketId = `${ticketPrefix}-${Math.floor(100000 + Math.random() * 900000)}`;

        const subject =
            reportType === 'chat_report'
                ? `[Chat Report] Reason: ${reason}`
                : reportType === 'job_report'
                  ? `[Job Report] Reason: ${reason}`
                  : `[User Report] Reason: ${reason}`;

        const humanLines = [
            `Report type: ${reportType.replace('_', ' ')}`,
            `Reason: ${reason}`,
            details?.trim() ? `Additional details: ${details.trim()}` : null,
            '',
            '— Reporter —',
            `Name: ${reportingUser?.fullName || 'N/A'}`,
            `Email: ${reportingUser?.email || authUser.email}`,
            `Phone: ${reportingUser?.mobile || 'N/A'}`,
            `User ID: ${authUser.id}`,
            '',
            '— Reported user —',
            `Name: ${reportedUser?.fullName || 'N/A'}`,
            `Email: ${reportedUser?.email || 'N/A'}`,
            `Phone: ${reportedUser?.mobile || 'N/A'}`,
            `User ID: ${reportedUser?.id || reportedUserId || 'N/A'}`,
            '',
            job
                ? [
                      '— Job —',
                      `Job ID: ${job.id}`,
                      `Title: ${job.jobTitle}`,
                      `Status: ${job.jobStatus}`,
                      `Category: ${job.jobCategory} / ${job.jobSubCategory}`,
                      `Type: ${job.projectType}`,
                      `Budget: ${job.budgetAmount} (${job.budgetType})`,
                      `Location: ${job.location || 'N/A'}`,
                      `Payment: ${job.paymentMethod} / ${job.paymentStatus}`,
                  ].join('\n')
                : jobId
                  ? `Job ID: ${jobId}`
                  : null,
            '',
            thread
                ? [
                      '— Chat thread —',
                      `Thread ID: ${thread.id}`,
                      `Status: ${thread.status}`,
                      `Accepted: ${thread.isAccepted ? 'yes' : 'no'}`,
                      `Agreed amount: ${thread.agreedAmount ?? 'N/A'}`,
                      `Client: ${thread.clientName || 'N/A'} (${thread.clientEmail || 'N/A'})`,
                      `Freelancer: ${thread.freelancerName || 'N/A'} (${thread.freelancerEmail || 'N/A'})`,
                  ].join('\n')
                : threadId
                  ? `Thread ID: ${threadId}`
                  : null,
        ]
            .filter((line) => line !== null)
            .join('\n');

        const meta = {
            type: reportType,
            reason,
            threadId: threadId || thread?.id || null,
            jobId: jobId || null,
            reporterUserId: authUser.id,
            reportedUserId: reportedUser?.id || reportedUserId || null,
            clientId: thread?.clientId || job?.clientId || null,
            freelancerId: thread?.freelancerId || job?.assignedFreelancerId || null,
        };

        const messageContent = `${humanLines}\n\n${META_MARKER}\n${JSON.stringify(meta)}`;

        const newContact = await db
            .insertInto('contacts')
            .values({
                id: uuidv4(),
                ticketId,
                name: reportingUser?.fullName || authUser.email || 'User',
                email: reportingUser?.email || authUser.email || 'no-email@birdearner.com',
                phone: reportingUser?.mobile?.trim() || null,
                subject,
                message: messageContent,
                status: 'pending',
                isRead: false,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returningAll()
            .executeTakeFirst();

        return NextResponse.json({
            success: true,
            message: 'Report submitted successfully',
            data: {
                ticketId: newContact?.ticketId || ticketId,
                reportType,
            },
        });
    } catch (error: any) {
        console.error('Submit report error:', error);
        return NextResponse.json(
            {
                success: false,
                message: error.message || 'Server error while submitting report',
            },
            { status: 500 }
        );
    }
}

async function loadThreadContext(threadId: string) {
    const row = await db
        .selectFrom('chatThreads as t')
        .leftJoin('clients as c', 'c.id', 't.clientId')
        .leftJoin('freelancers as f', 'f.id', 't.freelancerId')
        .leftJoin('users as cu', 'cu.id', 'c.userId')
        .leftJoin('users as fu', 'fu.id', 'f.userId')
        .select([
            't.id',
            't.jobId',
            't.clientId',
            't.freelancerId',
            't.status',
            't.isAccepted',
            't.agreedAmount',
            'c.userId as clientUserId',
            'f.userId as freelancerUserId',
            'cu.fullName as clientName',
            'cu.email as clientEmail',
            'fu.fullName as freelancerName',
            'fu.email as freelancerEmail',
        ])
        .where('t.id', '=', threadId)
        .executeTakeFirst();

    return row || null;
}

async function loadJobSummary(jobId: string) {
    const job = await db
        .selectFrom('jobs')
        .select([
            'id',
            'jobTitle',
            'jobDescription',
            'jobCategory',
            'jobSubCategory',
            'projectType',
            'budgetType',
            'budgetAmount',
            'jobStatus',
            'paymentMethod',
            'paymentStatus',
            'location',
            'clientId',
            'assignedFreelancerId',
            'createdAt',
            'deadlineDate',
            'workDeadline',
        ])
        .where('id', '=', jobId)
        .executeTakeFirst();

    return job || null;
}
