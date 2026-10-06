import { db } from '../db';
import { sql } from 'kysely';
import { sendNotification } from './notifications';
import { DB } from '../../types/types';

let isMigrated = false;

async function ensureNegotiationColumns() {
    if (isMigrated) return;
    try {
        await sql`
            ALTER TABLE "chatThreads" 
            ADD COLUMN IF NOT EXISTS "clientOffer" DECIMAL(10,2),
            ADD COLUMN IF NOT EXISTS "freelancerOffer" DECIMAL(10,2),
            ADD COLUMN IF NOT EXISTS "agreedAmount" DECIMAL(10,2);
        `.execute(db);
        isMigrated = true;
    } catch (err) {
        console.error('Migration execution warning:', err);
    }
}

/**
 * Find Another Freelancer edge case: after the client releases the assigned freelancer and
 * reopens the job, an isAccepted thread on a job that is OPEN again must never be
 * auto-restored to ACCEPTED via block/unblock. Returns 'REJECTED' for that case, else null
 * (callers keep their existing restore behaviour for every other case).
 */
export async function resolveRestoredThreadStatus(
    thread: { isAccepted?: boolean | null; jobId?: string | null },
    jobStatus?: string | null
): Promise<'PENDING' | 'ACCEPTED' | 'REJECTED' | 'COMPLETED' | 'BLOCKED' | null> {
    if (!thread.isAccepted) return null;
    let status = jobStatus ?? null;
    if (!status && thread.jobId) {
        const job = await db
            .selectFrom('jobs')
            .select('jobStatus')
            .where('id', '=', thread.jobId)
            .executeTakeFirst();
        status = job?.jobStatus ?? null;
    }
    return status === 'OPEN' ? 'REJECTED' : null;
}

/**
 * Create or get a chat thread
 */
export async function createOrGetThread(jobId: string, freelancerId: string, clientId: string, requesterUserId?: string) {
    await ensureNegotiationColumns();

    let thread = await db
        .selectFrom('chatThreads')
        .selectAll()
        .where('jobId', '=', jobId)
        .where('freelancerId', '=', freelancerId)
        .where('clientId', '=', clientId)
        .executeTakeFirst();

    if (thread) {
        const blockExists = await db
            .selectFrom('blockedUsers')
            .select('id')
            .where((eb) =>
                eb.or([
                    eb.and([
                        eb('blockerId', '=', clientId),
                        eb('blockedId', '=', freelancerId),
                    ]),
                    eb.and([
                        eb('blockerId', '=', freelancerId),
                        eb('blockedId', '=', clientId),
                    ]),
                ])
            )
            .executeTakeFirst();

        if (blockExists) {
            if (thread.status !== 'BLOCKED') {
                await db
                    .updateTable('chatThreads')
                    .set({ status: 'BLOCKED', updatedAt: new Date() })
                    .where('id', '=', thread.id)
                    .execute();
                thread.status = 'BLOCKED';
            }
        } else if (thread.status === 'BLOCKED') {
            // Block record was removed -> unblock chat thread automatically
            const reopenedOverride = await resolveRestoredThreadStatus(thread);
            const restoredStatus = reopenedOverride ?? (thread.isAccepted ? 'ACCEPTED' : 'PENDING');
            await db
                .updateTable('chatThreads')
                .set({ status: restoredStatus, updatedAt: new Date() })
                .where('id', '=', thread.id)
                .execute();
            thread.status = restoredStatus;
        }
    }

    // Find Another Freelancer: the previously selected freelancer cannot re-apply after the job is reopened.
    // Only this exact combination triggers the block (isAccepted is set solely on assignment; jobStatus is
    // only 'OPEN' again after a reopen), so every existing flow keeps its current behaviour. The client who
    // reopened the job still loads this thread normally; when no requester is passed (direct service callers)
    // the stricter freelancer-only behaviour is kept.
    if (thread?.isAccepted && thread.status === 'REJECTED') {
        const jobRow = await db
            .selectFrom('jobs')
            .select('jobStatus')
            .where('id', '=', jobId)
            .executeTakeFirst();

        if (jobRow?.jobStatus === 'OPEN') {
            const freelancerUser = await db
                .selectFrom('freelancers')
                .select('userId')
                .where('id', '=', freelancerId)
                .executeTakeFirst();

            if (!requesterUserId || requesterUserId === freelancerUser?.userId) {
                throw new Error('You were previously selected for this job and cannot apply again.');
            }
        }
    }

    if (!thread) {
        // Fetch freelancer and client records to prevent self-application/messaging
        const [freelancer, client] = await Promise.all([
            db.selectFrom('freelancers')
                .select(['userId', 'withdrawableAmount', 'cooldownExpiresAt'])
                .where('id', '=', freelancerId)
                .executeTakeFirst(),
            db.selectFrom('clients')
                .select('userId')
                .where('id', '=', clientId)
                .executeTakeFirst()
        ]);

        if (freelancer && client && freelancer.userId === client.userId) {
            throw new Error('You cannot apply to or message on jobs created by your own client profile.');
        }

        if (freelancer && freelancer.cooldownExpiresAt && new Date(freelancer.cooldownExpiresAt) > new Date()) {
            const hoursRemaining = Math.ceil((new Date(freelancer.cooldownExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60));
            throw new Error(`Your BirdEarner booking access is temporarily locked due to a recent cancellation or missed deadline. Cooldown active for remaining ${hoursRemaining} hour(s).`);
        }

        if (freelancer && parseFloat(freelancer.withdrawableAmount) < 0) {
            const outstanding = Math.abs(parseFloat(freelancer.withdrawableAmount)).toFixed(2);
            throw new Error(`Your BirdEarner platform fee of ₹${outstanding} is pending. Please pay the outstanding amount to continue applying for new bookings.`);
        }

        // Block check: prevent application if either party has blocked the other
        const blockExists = await db
            .selectFrom('blockedUsers')
            .select('id')
            .where((eb) =>
                eb.or([
                    eb.and([
                        eb('blockerId', '=', clientId),
                        eb('blockedId', '=', freelancerId),
                    ]),
                    eb.and([
                        eb('blockerId', '=', freelancerId),
                        eb('blockedId', '=', clientId),
                    ]),
                ])
            )
            .executeTakeFirst();

        if (blockExists) {
            throw new Error('You cannot apply to this job. This user has blocked you or you have blocked them.');
        }

        const job = await db
            .selectFrom('jobs')
            .select('budgetAmount')
            .where('id', '=', jobId)
            .executeTakeFirst();

        const initialBudget = job?.budgetAmount ? job.budgetAmount.toString() : '0';

        try {
            thread = await db
                .insertInto('chatThreads')
                .values({
                    id: crypto.randomUUID(),
                    jobId,
                    freelancerId,
                    clientId,
                    clientOffer: initialBudget,
                    freelancerOffer: initialBudget,
                    createdAt: new Date(),
                    updatedAt: new Date()
                })
                .returningAll()
                .executeTakeFirstOrThrow();
        } catch (insertError: any) {
            const errStr = String(insertError?.message || insertError || '');
            const isDuplicate = errStr.includes('duplicate key') || errStr.includes('unique constraint') || insertError?.code === '23505';
            if (isDuplicate) {
                thread = await db
                    .selectFrom('chatThreads')
                    .selectAll()
                    .where('jobId', '=', jobId)
                    .where('freelancerId', '=', freelancerId)
                    .where('clientId', '=', clientId)
                    .executeTakeFirst();
            }
            if (!thread) {
                throw insertError;
            }
        }

        // Notify Client
        if (client) {
            const freelancerUser = await db
                .selectFrom('freelancers')
                .innerJoin('users', 'users.id', 'freelancers.userId')
                .select('users.fullName')
                .where('freelancers.id', '=', freelancerId)
                .executeTakeFirst();

            const freelancerName = freelancerUser?.fullName || 'A Freelancer';

            sendNotification(
                client.userId,
                'CLIENT',
                'New Job Application',
                `${freelancerName} has applied/started a chat for your job.`,
                'JOB_APPLICATION',
                { threadId: thread.id, jobId, freelancerId }
            );
        }
    }

    return thread;
}

/**
 * Send a message
 */
export async function sendMessage(data: any) {
    const { chatThreadId, senderId, receiverId, messageContent, messageType, attachments, messageData, senderType } = data;

    if (!chatThreadId) throw new Error('chatThreadId is required');

    const thread = await db
        .selectFrom('chatThreads')
        .innerJoin('jobs', 'jobs.id', 'chatThreads.jobId')
        .select([
            'jobs.projectType',
            'jobs.jobStatus',
            'chatThreads.jobId',
            'chatThreads.characterLimit',
            'chatThreads.status',
            'chatThreads.isAccepted',
            'chatThreads.clientId',
            'chatThreads.freelancerId'
        ])
        .where('chatThreads.id', '=', chatThreadId)
        .where('jobs.deleted', '=', false)
        .executeTakeFirst();

    if (!thread) throw new Error('Chat thread not found');

    const blockExists = await db
        .selectFrom('blockedUsers')
        .select('id')
        .where((eb) =>
            eb.or([
                eb.and([
                    eb('blockerId', '=', thread.clientId),
                    eb('blockedId', '=', thread.freelancerId),
                ]),
                eb.and([
                    eb('blockerId', '=', thread.freelancerId),
                    eb('blockedId', '=', thread.clientId),
                ]),
            ])
        )
        .executeTakeFirst();

    if (blockExists) {
        if (thread.status !== 'BLOCKED') {
            await db
                .updateTable('chatThreads')
                .set({ status: 'BLOCKED', updatedAt: new Date() })
                .where('id', '=', chatThreadId)
                .execute();
        }
        throw new Error('This conversation has been blocked. You cannot send messages.');
    } else if (thread.status === 'BLOCKED') {
        const reopenedOverride = await resolveRestoredThreadStatus(thread, thread.jobStatus);
        const restoredStatus = reopenedOverride ?? (thread.isAccepted ? 'ACCEPTED' : 'PENDING');
        await db
            .updateTable('chatThreads')
            .set({ status: restoredStatus, updatedAt: new Date() })
            .where('id', '=', chatThreadId)
            .execute();
        thread.status = restoredStatus;
    }

    // Find Another Freelancer: once the client reopened the job, the released freelancer cannot post any
    // further messages in this thread (the client may still reply). Same exact-condition guard as above.
    if (thread.isAccepted && thread.status === 'REJECTED' && thread.jobStatus === 'OPEN') {
        const freelancerUser = await db
            .selectFrom('freelancers')
            .select('userId')
            .where('id', '=', thread.freelancerId)
            .executeTakeFirst();

        if (senderId === thread.freelancerId || (freelancerUser && senderId === freelancerUser.userId)) {
            throw new Error('You were previously selected for this job and cannot apply again.');
        }
    }

    // Check character limit for OPEN jobs
    if (thread.jobStatus === 'OPEN' && thread.characterLimit) {
        const senderMessages = await db
            .selectFrom('messages')
            .select('messageContent')
            .where('chatThreadId', '=', chatThreadId)
            .where('senderId', '=', senderId)
            .execute();

        const currentUsage = senderMessages.reduce((total, msg) => total + (msg.messageContent?.length || 0), 0);

        if (currentUsage + messageContent.length > thread.characterLimit) {
            const remaining = Math.max(0, thread.characterLimit - currentUsage);
            throw new Error(`Message would exceed cumulative character limit. You have ${remaining} characters remaining.`);
        }
    }

    let finalMessageData: any = {};
    if (messageData) {
        try {
            finalMessageData = typeof messageData === 'string' ? JSON.parse(messageData) : { ...messageData };
        } catch (e) {
            finalMessageData = {};
        }
    }

    const isSubmissionMessage = Boolean(finalMessageData.isWorkSubmission);

    let jobSubmissionVersion: number | undefined;

    if (isSubmissionMessage) {
        // Work submission is ONLY through a file attachment
        let parsedAttachments: any[] = [];
        try {
            if (Array.isArray(attachments)) parsedAttachments = attachments;
            else if (typeof attachments === 'string' && attachments) parsedAttachments = JSON.parse(attachments);
        } catch (e) {
            parsedAttachments = [];
        }

        const associatedAttachments = Array.isArray(finalMessageData.submissionAttachments)
            ? finalMessageData.submissionAttachments
            : [];
        const primaryFile = associatedAttachments[0] || parsedAttachments[0];
        if (!primaryFile || !primaryFile.attachmentUrl) {
            throw new Error('Work submission must include a file attachment');
        }

        const submittableStatuses = ['CONFIRMED', 'IN_PROGRESS', 'REVISION_REQUESTED', 'WORK_SUBMITTED'];
        if (!submittableStatuses.includes(thread.jobStatus)) {
            throw new Error(`Work cannot be submitted while job status is ${thread.jobStatus}`);
        }

        const { submitDigitalWork } = await import('./jobs');
        const updatedJob = await submitDigitalWork(thread.jobId, senderId, {
            fileUrl: primaryFile.attachmentUrl,
            notes: messageContent || '',
        });

        let jobSwd: any = updatedJob.submittedWorkData;
        try {
            if (typeof jobSwd === 'string') jobSwd = JSON.parse(jobSwd);
        } catch (e) {}
        if (jobSwd && typeof jobSwd.version === 'number') {
            jobSubmissionVersion = jobSwd.version;
        }

        // Find existing work submission messages in this chatThreadId
        const existingMsgs = await db
            .selectFrom('messages')
            .select(['id', 'messageData', 'attachments', 'createdAt'])
            .where('chatThreadId', '=', chatThreadId)
            .orderBy('createdAt', 'asc')
            .execute();

        const submissions: Array<{
            id: string;
            version: number;
            submissionStatus: string;
            reviewed: boolean;
            msgData: any;
            createdAt: Date;
        }> = [];

        for (const msg of existingMsgs) {
            let mData: any = {};
            try {
                if (msg.messageData) mData = typeof msg.messageData === 'string' ? JSON.parse(msg.messageData) : msg.messageData;
            } catch (e) {}

            if (mData.isWorkSubmission || mData.version !== undefined) {
                const version = typeof mData.version === 'number' ? mData.version : 1;
                const submissionStatus = mData.submissionStatus || 'PENDING';
                const reviewed = Boolean(mData.reviewed || submissionStatus === 'ACCEPTED' || submissionStatus === 'REVISE_REQUESTED');

                submissions.push({
                    id: msg.id,
                    version,
                    submissionStatus,
                    reviewed,
                    msgData: mData,
                    createdAt: msg.createdAt,
                });
            }
        }

        let targetVersion = 1;

        if (submissions.length > 0) {
            const latestSub = submissions[submissions.length - 1];
            targetVersion = latestSub.version;

            if (!latestSub.reviewed) {
                // CASE A: Latest submission version is UNREVIEWED -> Keep same version (targetVersion)
                // Disable previous review controls on all messages belonging to this unreviewed version
                for (const sub of submissions) {
                    if (sub.version === targetVersion) {
                        const updatedData = {
                            ...sub.msgData,
                            isLatestForVersion: false,
                            reviewControlActive: false,
                        };
                        await db
                            .updateTable('messages')
                            .set({
                                messageData: JSON.stringify(updatedData),
                                updatedAt: new Date(),
                            })
                            .where('id', '=', sub.id)
                            .execute();
                    }
                }
            } else {
                // CASE B: Latest submission version HAS BEEN REVIEWED -> Create Version + 1
                targetVersion = latestSub.version + 1;
            }
        } else {
            // First submission -> Version 1
            targetVersion = 1;
        }

        finalMessageData = {
            ...finalMessageData,
            isWorkSubmission: true,
            version: jobSubmissionVersion ?? targetVersion,
            submissionStatus: 'PENDING',
            reviewed: false,
            reviewedAt: null,
            reviewedBy: null,
            isLatestForVersion: true,
            reviewControlActive: true,
        };
    }

    const message = await db
        .insertInto('messages')
        .values({
            id: crypto.randomUUID(),
            chatThreadId,
            senderId,
            receiverId,
            messageContent,
            messageType,
            attachments: attachments ? (typeof attachments === 'string' ? attachments : JSON.stringify(attachments)) : null,
            messageData: JSON.stringify(finalMessageData),
            senderType,
            createdAt: new Date(),
            updatedAt: new Date()
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    // Notify receiver
    const sender = await db
        .selectFrom('users')
        .select('fullName')
        .where('id', '=', senderId)
        .executeTakeFirst();

    sendNotification(
        receiverId,
        'USER',
        'New Message',
        `You have a new message from ${sender?.fullName || 'User'}`,
        'CHAT',
        { threadId: chatThreadId, senderId, senderName: sender?.fullName }
    );

    return message;
}

/**
 * Respond to work submission attachment message (ACCEPT or REVISE_REQUESTED)
 */
export async function respondToWorkSubmissionMessage(
    messageId: string,
    clientUserId: string,
    decision: 'ACCEPT' | 'REVISE_REQUESTED',
    revisionNotes?: string
) {
    const msg = await db
        .selectFrom('messages')
        .innerJoin('chatThreads', 'chatThreads.id', 'messages.chatThreadId')
        .innerJoin('jobs', 'jobs.id', 'chatThreads.jobId')
        .select([
            'messages.id',
            'messages.messageData',
            'messages.attachments',
            'jobs.id as jobId',
            'jobs.projectType',
            'jobs.jobStatus',
            'chatThreads.clientId',
            'chatThreads.id as chatThreadId'
        ])
        .where('messages.id', '=', messageId)
        .executeTakeFirst();

    if (!msg) throw new Error('Submission message not found');

    const client = await db.selectFrom('clients').select('userId').where('id', '=', msg.clientId).executeTakeFirst();
    if (!client || client.userId !== clientUserId) {
        throw new Error('Unauthorized');
    }

    if (msg.jobStatus === 'DISPUTE_OPEN') {
        throw new Error('A dispute is open for this job. Accept / Revise is disabled until an admin resolves the dispute.');
    }

    let parsedData: any = {};
    try {
        if (msg.messageData) parsedData = typeof msg.messageData === 'string' ? JSON.parse(msg.messageData) : msg.messageData;
    } catch (e) {}

    if (parsedData.reviewed || (parsedData.submissionStatus && parsedData.submissionStatus !== 'PENDING')) {
        throw new Error('Decision has already been selected for this submission version.');
    }

    const targetVersion = typeof parsedData.version === 'number' ? parsedData.version : 1;
    const newStatus = decision === 'ACCEPT' ? 'ACCEPTED' : 'REVISE_REQUESTED';
    const reviewedAt = new Date().toISOString();

    // Query all messages in this chatThreadId to update all messages belonging to targetVersion
    const threadMsgs = await db
        .selectFrom('messages')
        .select(['id', 'messageData'])
        .where('chatThreadId', '=', msg.chatThreadId)
        .execute();

    for (const threadMsg of threadMsgs) {
        let mData: any = {};
        try {
            if (threadMsg.messageData) mData = typeof threadMsg.messageData === 'string' ? JSON.parse(threadMsg.messageData) : threadMsg.messageData;
        } catch (e) {}

        const msgVersion = typeof mData.version === 'number' ? mData.version : 1;
        if (mData.isWorkSubmission && msgVersion === targetVersion) {
            mData.submissionStatus = newStatus;
            mData.reviewed = true;
            mData.reviewedAt = reviewedAt;
            mData.reviewedBy = clientUserId;
            mData.decisionMadeAt = reviewedAt;
            if (decision === 'REVISE_REQUESTED') {
                mData.revisionNotes = revisionNotes || 'Client requested revisions';
            }

            await db
                .updateTable('messages')
                .set({
                    messageData: JSON.stringify(mData),
                    updatedAt: new Date()
                })
                .where('id', '=', threadMsg.id)
                .execute();
        }
    }

    const { respondToDigitalWork } = await import('./jobs');

    if (decision === 'ACCEPT') {
        await respondToDigitalWork(msg.jobId, clientUserId, 'ACCEPT');
    } else {
        await respondToDigitalWork(msg.jobId, clientUserId, 'REQUEST_REVISION', revisionNotes);
    }

    return { success: true, messageId, submissionStatus: newStatus, version: targetVersion };
}

/**
 * Get conversations for a user
 */
export async function getConversations(userId: string, role: 'CLIENT' | 'FREELANCER') {
    let query = db
        .selectFrom('chatThreads')
        .innerJoin('jobs', 'jobs.id', 'chatThreads.jobId')
        .leftJoin('clients', 'clients.id', 'chatThreads.clientId')
        .leftJoin('users as clientUser', 'clientUser.id', 'clients.userId')
        .leftJoin('freelancers', 'freelancers.id', 'chatThreads.freelancerId')
        .leftJoin('users as freeUser', 'freeUser.id', 'freelancers.userId')
        .where('jobs.deleted', '=', false);

    if (role === 'CLIENT') {
        const client = await db.selectFrom('clients').select('id').where('userId', '=', userId).executeTakeFirst();
        if (!client) return [];
        query = query.where('chatThreads.clientId', '=', client.id);
    } else {
        const freelancer = await db.selectFrom('freelancers').select('id').where('userId', '=', userId).executeTakeFirst();
        if (!freelancer) return [];
        query = query.where('chatThreads.freelancerId', '=', freelancer.id);
    }

    const threads = await query
        .select([
            'chatThreads.id',
            'chatThreads.jobId',
            'chatThreads.clientId',
            'chatThreads.freelancerId',
            'chatThreads.status',
            'chatThreads.isAccepted',
            'chatThreads.updatedAt',
            'chatThreads.characterLimit',
            'jobs.jobTitle',
            'jobs.jobStatus',
            'jobs.deadlineDate',
            'clientUser.fullName as clientName',
            'clientUser.id as clientUserId',
            'clientUser.profilePhoto as clientPhoto',
            'freeUser.fullName as freelancerName',
            'freeUser.id as freelancerUserId',
            'freeUser.profilePhoto as freelancerPhoto'
        ])
        .orderBy('chatThreads.updatedAt', 'desc')
        .execute();

    // Get last message for each thread & auto-sync block status
    const conversations = await Promise.all(threads.map(async (thread) => {
        const blockExists = await db
            .selectFrom('blockedUsers')
            .select('id')
            .where((eb) =>
                eb.or([
                    eb.and([
                        eb('blockerId', '=', thread.clientId),
                        eb('blockedId', '=', thread.freelancerId),
                    ]),
                    eb.and([
                        eb('blockerId', '=', thread.freelancerId),
                        eb('blockedId', '=', thread.clientId),
                    ]),
                ])
            )
            .executeTakeFirst();

        let currentStatus = thread.status;
        if (blockExists) {
            currentStatus = 'BLOCKED';
            if (thread.status !== 'BLOCKED') {
                await db.updateTable('chatThreads')
                    .set({ status: 'BLOCKED', updatedAt: new Date() })
                    .where('id', '=', thread.id)
                    .execute();
            }
        } else if (thread.status === 'BLOCKED') {
            const reopenedOverride = await resolveRestoredThreadStatus(thread, thread.jobStatus);
            currentStatus = reopenedOverride ?? (thread.isAccepted ? 'ACCEPTED' : 'PENDING');
            await db.updateTable('chatThreads')
                .set({ status: currentStatus, updatedAt: new Date() })
                .where('id', '=', thread.id)
                .execute();
        }

        const lastMessage = await db
            .selectFrom('messages')
            .select(['messageContent', 'messageType', 'createdAt'])
            .where('chatThreadId', '=', thread.id)
            .orderBy('createdAt', 'desc')
            .executeTakeFirst();

        let displayMessage = lastMessage?.messageContent || 'No messages yet';

        // Format message preview based on type
        if (lastMessage) {
            try {
                if (lastMessage.messageType === 'review_request') {
                    const content = JSON.parse(lastMessage.messageContent);
                    displayMessage = content.status === 'completed' ? 'Review submitted' : 'Review requested';
                } else if (lastMessage.messageType === 'completion_request') {
                    const content = JSON.parse(lastMessage.messageContent);
                    displayMessage = content.status === 'confirmed' ? 'Project completed' : 'Completion requested';
                } else if (lastMessage.messageType === 'cash_payment') {
                    const content = JSON.parse(lastMessage.messageContent);
                    displayMessage = content.step === 'completed' ? 'Payment completed' : 'Cash payment process';
                } else if (lastMessage.messageType === 'image') {
                    displayMessage = '📷 Image';
                } else if (lastMessage.messageType === 'attachment') {
                    displayMessage = '📎 Attachment';
                } else if (lastMessage.messageType === 'notification') {
                    displayMessage = lastMessage.messageContent;
                }
            } catch (e) {
                // If parsing fails or it's just text, keep original content
            }
        }

        let otherUser = null;
        if (role === 'CLIENT') {
            otherUser = {
                id: thread.freelancerId,
                userId: thread.freelancerUserId,
                profilePhoto: thread.freelancerPhoto,
                user: {
                    id: thread.freelancerUserId,
                    fullName: thread.freelancerName || 'Unknown Freelancer'
                }
            };
        } else {
            otherUser = {
                id: thread.clientId,
                userId: thread.clientUserId,
                profilePhoto: thread.clientPhoto,
                user: {
                    id: thread.clientUserId,
                    fullName: thread.clientName || 'Unknown Client'
                }
            };
        }

        return {
            ...thread,
            status: currentStatus,
            otherUser,
            lastMessage: displayMessage,
            lastMessageAt: lastMessage?.createdAt || thread.updatedAt
        };
    }));

    return conversations;
}
