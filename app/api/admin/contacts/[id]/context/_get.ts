import { getAdminUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { sql } from 'kysely';
import { NextResponse } from 'next/server';

const META_MARKER = '---REPORT_META---';

type ReportMeta = {
    type?: string;
    reason?: string;
    threadId?: string | null;
    jobId?: string | null;
    reporterUserId?: string | null;
    reportedUserId?: string | null;
    clientId?: string | null;
    freelancerId?: string | null;
};

function parseReportMeta(message: string): ReportMeta {
    if (!message) return {};
    const idx = message.lastIndexOf(META_MARKER);
    if (idx >= 0) {
        try {
            return JSON.parse(message.slice(idx + META_MARKER.length).trim());
        } catch {
            // fall through to regex parsing for older tickets
        }
    }

    const threadMatch = message.match(/Thread ID:\s*([0-9a-f-]{36})/i);
    const jobMatch = message.match(/Job ID:\s*([0-9a-f-]{36})/i);
    const reportedMatch = message.match(/Reported User ID:\s*([0-9a-f-]{36})/i);
    const reporterMatch = message.match(/Reporter User ID:\s*([0-9a-f-]{36})/i);
    const reasonMatch = message.match(/Reason:\s*(.+)/i);

    return {
        type: message.includes('[Chat Report]') || message.includes('Thread ID:')
            ? 'chat_report'
            : message.includes('Job ID:')
              ? 'job_report'
              : 'user_report',
        reason: reasonMatch?.[1]?.trim(),
        threadId: threadMatch?.[1] || null,
        jobId: jobMatch?.[1] || null,
        reportedUserId: reportedMatch?.[1] || null,
        reporterUserId: reporterMatch?.[1] || null,
    };
}

function stripMeta(message: string) {
    if (!message) return '';
    const idx = message.lastIndexOf(META_MARKER);
    return (idx >= 0 ? message.slice(0, idx) : message).trim();
}

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        if (!id) {
            return NextResponse.json({ success: false, message: 'Contact ID is required' }, { status: 400 });
        }

        const contact = await db
            .selectFrom('contacts')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        if (!contact) {
            return NextResponse.json({ success: false, message: 'Contact not found' }, { status: 404 });
        }

        const meta = parseReportMeta(contact.message || '');
        const isReport =
            String(contact.subject || '').includes('[Chat Report]') ||
            String(contact.subject || '').includes('[Job Report]') ||
            String(contact.subject || '').includes('[User Report]') ||
            !!meta.threadId ||
            !!meta.jobId ||
            meta.type?.includes('report');

        if (!isReport) {
            return NextResponse.json({
                success: true,
                data: {
                    contact: {
                        ...contact,
                        message: stripMeta(contact.message || ''),
                    },
                    meta: null,
                    report: null,
                },
            });
        }

        let threadId = meta.threadId || null;
        let jobId = meta.jobId || null;

        let thread: any = null;
        if (threadId) {
            thread = await db
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
                    't.agreedDays',
                    't.clientOffer',
                    't.freelancerOffer',
                    't.createdAt',
                    't.updatedAt',
                    't.deadline',
                    'c.userId as clientUserId',
                    'f.userId as freelancerUserId',
                    'cu.fullName as clientName',
                    'cu.email as clientEmail',
                    'cu.mobile as clientMobile',
                    'fu.fullName as freelancerName',
                    'fu.email as freelancerEmail',
                    'fu.mobile as freelancerMobile',
                ])
                .where('t.id', '=', threadId)
                .executeTakeFirst();

            if (thread?.jobId && !jobId) jobId = thread.jobId;
        }

        let job: any = null;
        if (jobId) {
            job = await db
                .selectFrom('jobs as j')
                .leftJoin('clients as c', 'c.id', 'j.clientId')
                .leftJoin('users as cu', 'cu.id', 'c.userId')
                .leftJoin('freelancers as f', 'f.id', 'j.assignedFreelancerId')
                .leftJoin('users as fu', 'fu.id', 'f.userId')
                .select([
                    'j.id',
                    'j.jobTitle',
                    'j.jobDescription',
                    'j.jobCategory',
                    'j.jobSubCategory',
                    'j.projectType',
                    'j.budgetType',
                    'j.budgetAmount',
                    'j.negotiatedAmount',
                    'j.jobStatus',
                    'j.paymentMethod',
                    'j.paymentStatus',
                    'j.location',
                    'j.skillsRequired',
                    'j.deadlineDate',
                    'j.workDeadline',
                    'j.createdAt',
                    'j.assignedAt',
                    'j.completedAt',
                    'j.clientId',
                    'j.assignedFreelancerId',
                    'cu.id as clientUserId',
                    'cu.fullName as clientName',
                    'cu.email as clientEmail',
                    'cu.mobile as clientMobile',
                    'fu.id as freelancerUserId',
                    'fu.fullName as freelancerName',
                    'fu.email as freelancerEmail',
                    'fu.mobile as freelancerMobile',
                ])
                .where('j.id', '=', jobId)
                .executeTakeFirst();
        }

        // If we have a job but no thread, resolve the latest chat thread for that job
        if (!thread && jobId) {
            thread =
                (await db
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
                        't.agreedDays',
                        't.clientOffer',
                        't.freelancerOffer',
                        't.createdAt',
                        't.updatedAt',
                        't.deadline',
                        'c.userId as clientUserId',
                        'f.userId as freelancerUserId',
                        'cu.fullName as clientName',
                        'cu.email as clientEmail',
                        'cu.mobile as clientMobile',
                        'fu.fullName as freelancerName',
                        'fu.email as freelancerEmail',
                        'fu.mobile as freelancerMobile',
                    ])
                    .where('t.jobId', '=', jobId)
                    .orderBy('t.updatedAt', 'desc')
                    .executeTakeFirst()) || null;
            if (thread) threadId = thread.id;
        }

        let messages: any[] = [];
        const messageSelect = [
            'id',
            'senderId',
            'receiverId',
            'messageContent',
            'messageType',
            'messageData',
            'attachments',
            'senderType',
            'isRead',
            'createdAt',
            'jobId',
            'chatThreadId',
        ] as const;

        let raw: any[] = [];
        if (threadId) {
            raw = await db
                .selectFrom('messages')
                .select([...messageSelect])
                .where('chatThreadId', '=', threadId)
                .orderBy('createdAt', 'asc')
                .orderBy('id', 'asc')
                .limit(200)
                .execute();
        }

        // Fallback: some older rows are keyed by jobId only
        if (raw.length === 0 && jobId) {
            raw = await db
                .selectFrom('messages')
                .select([...messageSelect])
                .where('jobId', '=', jobId)
                .orderBy('createdAt', 'asc')
                .orderBy('id', 'asc')
                .limit(200)
                .execute();
        }

        if (raw.length > 0) {
            const senderIds = [...new Set(raw.map((m) => m.senderId).filter(Boolean))];
            const senders =
                senderIds.length > 0
                    ? await db
                          .selectFrom('users')
                          .select(['id', 'fullName', 'email'])
                          .where('id', 'in', senderIds)
                          .execute()
                    : [];
            const senderMap = Object.fromEntries(senders.map((s) => [s.id, s]));

            messages = raw.map((m) => ({
                ...m,
                senderName:
                    m.senderType === 'SYSTEM'
                        ? 'System'
                        : senderMap[m.senderId]?.fullName ||
                          senderMap[m.senderId]?.email ||
                          m.senderId,
            }));
        }

        let reporter = null as
            | {
                  id: string;
                  fullName: string | null;
                  email: string;
                  mobile: string | null;
                  createdAt: Date;
              }
            | null;
        let reported = null as typeof reporter;

        if (meta.reporterUserId) {
            reporter =
                (await db
                    .selectFrom('users')
                    .select(['id', 'fullName', 'email', 'mobile', 'createdAt'])
                    .where('id', '=', meta.reporterUserId)
                    .executeTakeFirst()) || null;
        }

        // Resolve reporter by contact email when meta has no reporterUserId
        if (!reporter && contact.email) {
            reporter =
                (await db
                    .selectFrom('users')
                    .select(['id', 'fullName', 'email', 'mobile', 'createdAt'])
                    .where(sql`lower(email)`, '=', String(contact.email).trim().toLowerCase())
                    .executeTakeFirst()) || null;
        }

        if (meta.reportedUserId) {
            reported =
                (await db
                    .selectFrom('users')
                    .select(['id', 'fullName', 'email', 'mobile', 'createdAt'])
                    .where('id', '=', meta.reportedUserId)
                    .executeTakeFirst()) || null;
        }

        const resolvedPhone =
            String(contact.phone || '').trim() ||
            String(reporter?.mobile || '').trim() ||
            null;

        // Persist missing phone so list/detail stay consistent next time
        if (!String(contact.phone || '').trim() && resolvedPhone) {
            await db
                .updateTable('contacts')
                .set({ phone: resolvedPhone, updatedAt: new Date() })
                .where('id', '=', id)
                .execute();
        }

        return NextResponse.json({
            success: true,
            data: {
                contact: {
                    ...contact,
                    phone: resolvedPhone,
                    message: stripMeta(contact.message || ''),
                },
                meta: {
                    ...meta,
                    threadId,
                    jobId,
                },
                report: {
                    job,
                    thread,
                    messages,
                    reporter,
                    reported,
                },
            },
        });
    } catch (error: any) {
        console.error('Get contact context error:', error);
        return NextResponse.json(
            { success: false, message: error.message || 'Server error' },
            { status: 500 }
        );
    }
}
