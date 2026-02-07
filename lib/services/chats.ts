import { db } from '../db';
import { sendNotification } from './notifications';
import { DB } from '../../types/types';

/**
 * Create or get a chat thread
 */
export async function createOrGetThread(jobId: string, freelancerId: string, clientId: string) {
    // Check if freelancer has a negative balance
    const freelancer = await db
        .selectFrom('freelancers')
        .select('withdrawableAmount')
        .where('id', '=', freelancerId)
        .executeTakeFirst();

    if (freelancer && parseFloat(freelancer.withdrawableAmount) < 0) {
        throw new Error('You have an outstanding negative balance. Please settle your fees before applying for new jobs.');
    }

    let thread = await db
        .selectFrom('chatThreads')
        .selectAll()
        .where('jobId', '=', jobId)
        .where('freelancerId', '=', freelancerId)
        .where('clientId', '=', clientId)
        .executeTakeFirst();

    if (!thread) {
        thread = await db
            .insertInto('chatThreads')
            .values({
                id: crypto.randomUUID(),
                jobId,
                freelancerId,
                clientId,
                updatedAt: new Date()
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        // Notify Client
        const client = await db
            .selectFrom('clients')
            .select('userId')
            .where('id', '=', clientId)
            .executeTakeFirst();

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
    const { chatThreadId, senderId, receiverId, messageContent, messageType, attachments, senderType } = data;

    if (!chatThreadId) throw new Error('chatThreadId is required');

    const thread = await db
        .selectFrom('chatThreads')
        .innerJoin('jobs', 'jobs.id', 'chatThreads.jobId')
        .select(['jobs.jobStatus', 'chatThreads.characterLimit'])
        .where('chatThreads.id', '=', chatThreadId)
        .executeTakeFirst();

    if (!thread) throw new Error('Chat thread not found');

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

    const message = await db
        .insertInto('messages')
        .values({
            id: crypto.randomUUID(),
            chatThreadId,
            senderId,
            receiverId,
            messageContent,
            messageType,
            attachments: attachments ? JSON.stringify(attachments) : null,
            senderType,
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
 * Get conversations for a user
 */
export async function getConversations(userId: string, role: 'CLIENT' | 'FREELANCER') {
    let query = db
        .selectFrom('chatThreads')
        .innerJoin('jobs', 'jobs.id', 'chatThreads.jobId')
        .leftJoin('clients', 'clients.id', 'chatThreads.clientId')
        .leftJoin('users as clientUser', 'clientUser.id', 'clients.userId')
        .leftJoin('freelancers', 'freelancers.id', 'chatThreads.freelancerId')
        .leftJoin('users as freeUser', 'freeUser.id', 'freelancers.userId');

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
            'chatThreads.status',
            'chatThreads.isAccepted',
            'chatThreads.updatedAt',
            'jobs.jobTitle',
            'jobs.jobStatus',
            'jobs.deadlineDate',
            'clientUser.fullName as clientName',
            'clientUser.id as clientUserId',
            'clients.profilePhoto as clientPhoto',
            'freeUser.fullName as freelancerName',
            'freeUser.id as freelancerUserId',
            'freelancers.profilePhoto as freelancerPhoto'
        ])
        .orderBy('chatThreads.updatedAt', 'desc')
        .execute();

    // Get last message for each thread
    const conversations = await Promise.all(threads.map(async (thread) => {
        const lastMessage = await db
            .selectFrom('messages')
            .select(['messageContent', 'createdAt'])
            .where('chatThreadId', '=', thread.id)
            .orderBy('createdAt', 'desc')
            .executeTakeFirst();

        return {
            ...thread,
            lastMessage: lastMessage?.messageContent || 'No messages yet',
            lastMessageAt: lastMessage?.createdAt || thread.updatedAt
        };
    }));

    return conversations;
}
