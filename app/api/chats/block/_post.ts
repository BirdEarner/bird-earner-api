import { getAuthUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const blockSchema = z.object({
    threadId: z.string(),
    userId: z.string(),
    blockedUserId: z.string(),
});

export async function POST(request: Request) {
    try {
        const authUser = await getAuthUser();
        if (!authUser) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const parsed = blockSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { success: false, message: parsed.error.issues[0]?.message || 'Invalid input' },
                { status: 400 }
            );
        }

        const { threadId, userId, blockedUserId } = parsed.data;

        const blockerClient = await db
            .selectFrom('clients')
            .select(['id', 'userId'])
            .where('userId', '=', userId)
            .executeTakeFirst();

        const blockerFreelancer = await db
            .selectFrom('freelancers')
            .select(['id', 'userId'])
            .where('userId', '=', userId)
            .executeTakeFirst();

        const blockedClient = await db
            .selectFrom('clients')
            .select(['id', 'userId'])
            .where('userId', '=', blockedUserId)
            .executeTakeFirst();

        const blockedFreelancer = await db
            .selectFrom('freelancers')
            .select(['id', 'userId'])
            .where('userId', '=', blockedUserId)
            .executeTakeFirst();

        let blockerId: string;
        let blockedId: string;
        let blockerType: string;
        let blockedType: string;

        if (blockerClient) {
            blockerId = blockerClient.id;
            blockerType = 'CLIENT';
        } else if (blockerFreelancer) {
            blockerId = blockerFreelancer.id;
            blockerType = 'FREELANCER';
        } else {
            return NextResponse.json({ success: false, message: 'Blocker profile not found' }, { status: 400 });
        }

        if (blockedClient) {
            blockedId = blockedClient.id;
            blockedType = 'CLIENT';
        } else if (blockedFreelancer) {
            blockedId = blockedFreelancer.id;
            blockedType = 'FREELANCER';
        } else {
            return NextResponse.json({ success: false, message: 'Blocked user profile not found' }, { status: 400 });
        }

        const existing = await db
            .selectFrom('blockedUsers')
            .select('id')
            .where('blockerId', '=', blockerId!)
            .where('blockedId', '=', blockedId!)
            .executeTakeFirst();

        if (!existing) {
            await db
                .insertInto('blockedUsers')
                .values({
                    id: crypto.randomUUID(),
                    blockerId: blockerId!,
                    blockedId: blockedId!,
                    blockerType: blockerType!,
                    blockedType: blockedType!,
                    createdAt: new Date(),
                })
                .execute();
        }

        // Block threads between these two parties, EXCEPT those with active jobs
        let clientIdForQuery: string | null = null;
        let freelancerIdForQuery: string | null = null;

        if (blockerType === 'CLIENT') {
            clientIdForQuery = blockerId!;
            freelancerIdForQuery = blockedId!;
        } else {
            clientIdForQuery = blockedId!;
            freelancerIdForQuery = blockerId!;
        }

        // Job statuses where the job is actively in progress (threads should remain accessible)
        const ACTIVE_JOB_STATUSES = [
            'CONFIRMED', 'IN_PROGRESS', 'FREELANCER_TRAVELLING', 'ARRIVED',
            'JOB_STARTED', 'WORK_SUBMITTED', 'REVISION_REQUESTED',
            'REVISION_SUBMITTED', 'WORK_ACCEPTED'
        ];

        // Get all threads between these parties
        const allThreads = await db
            .selectFrom('chatThreads')
            .innerJoin('jobs', 'jobs.id', 'chatThreads.jobId')
            .select(['chatThreads.id', 'jobs.jobStatus'])
            .where('chatThreads.clientId', '=', clientIdForQuery!)
            .where('chatThreads.freelancerId', '=', freelancerIdForQuery!)
            .execute();

        // Separate into blockable and active threads
        const blockableThreadIds: string[] = [];
        for (const thread of allThreads) {
            if (!ACTIVE_JOB_STATUSES.includes(thread.jobStatus)) {
                blockableThreadIds.push(thread.id);
            }
        }

        // Only block threads for non-active jobs
        if (blockableThreadIds.length > 0) {
            await db
                .updateTable('chatThreads')
                .set({ status: 'BLOCKED', updatedAt: new Date() })
                .where('id', 'in', blockableThreadIds)
                .execute();
        }

        return NextResponse.json({
            success: true,
            message: 'User blocked successfully',
        });
    } catch (error: any) {
        console.error('Block user error:', error);
        return NextResponse.json(
            { success: false, message: error.message || 'Server error while blocking user' },
            { status: 500 }
        );
    }
}
