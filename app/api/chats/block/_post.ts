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

        // Fetch current chat thread if threadId is provided
        let currentThread = threadId ? await db
            .selectFrom('chatThreads')
            .innerJoin('jobs', 'jobs.id', 'chatThreads.jobId')
            .select(['chatThreads.id', 'chatThreads.clientId', 'chatThreads.freelancerId', 'jobs.jobStatus'])
            .where('chatThreads.id', '=', threadId)
            .executeTakeFirst() : null;

        let blockerId: string;
        let blockedId: string;
        let blockerType: 'CLIENT' | 'FREELANCER';
        let blockedType: 'CLIENT' | 'FREELANCER';
        let clientIdForQuery: string;
        let freelancerIdForQuery: string;

        const [blockerClient, blockerFreelancer] = await Promise.all([
            db.selectFrom('clients').select(['id', 'userId']).where('userId', '=', userId).executeTakeFirst(),
            db.selectFrom('freelancers').select(['id', 'userId']).where('userId', '=', userId).executeTakeFirst()
        ]);

        if (currentThread) {
            clientIdForQuery = currentThread.clientId;
            freelancerIdForQuery = currentThread.freelancerId;

            if (blockerClient && blockerClient.id === currentThread.clientId) {
                blockerId = currentThread.clientId;
                blockerType = 'CLIENT';
                blockedId = currentThread.freelancerId;
                blockedType = 'FREELANCER';
            } else if (blockerFreelancer && blockerFreelancer.id === currentThread.freelancerId) {
                blockerId = currentThread.freelancerId;
                blockerType = 'FREELANCER';
                blockedId = currentThread.clientId;
                blockedType = 'CLIENT';
            } else {
                const blockedClient = await db.selectFrom('clients').select('id').where('userId', '=', blockedUserId).executeTakeFirst();
                if (blockedClient && blockedClient.id === currentThread.clientId) {
                    blockerId = currentThread.freelancerId;
                    blockerType = 'FREELANCER';
                    blockedId = currentThread.clientId;
                    blockedType = 'CLIENT';
                } else {
                    blockerId = currentThread.clientId;
                    blockerType = 'CLIENT';
                    blockedId = currentThread.freelancerId;
                    blockedType = 'FREELANCER';
                }
            }
        } else {
            const [blockedClient, blockedFreelancer] = await Promise.all([
                db.selectFrom('clients').select(['id', 'userId']).where('userId', '=', blockedUserId).executeTakeFirst(),
                db.selectFrom('freelancers').select(['id', 'userId']).where('userId', '=', blockedUserId).executeTakeFirst()
            ]);

            if (blockerClient && blockedFreelancer) {
                blockerId = blockerClient.id;
                blockerType = 'CLIENT';
                blockedId = blockedFreelancer.id;
                blockedType = 'FREELANCER';
                clientIdForQuery = blockerId;
                freelancerIdForQuery = blockedId;
            } else if (blockerFreelancer && blockedClient) {
                blockerId = blockerFreelancer.id;
                blockerType = 'FREELANCER';
                blockedId = blockedClient.id;
                blockedType = 'CLIENT';
                clientIdForQuery = blockedId;
                freelancerIdForQuery = blockerId;
            } else {
                return NextResponse.json({ success: false, message: 'User profiles could not be resolved for blocking' }, { status: 400 });
            }
        }

        // Active job protection check
        const ACTIVE_JOB_STATUSES = [
            'CONFIRMED', 'IN_PROGRESS', 'FREELANCER_TRAVELLING', 'ARRIVED',
            'JOB_STARTED', 'WORK_SUBMITTED', 'REVISION_REQUESTED',
            'REVISION_SUBMITTED', 'WORK_ACCEPTED'
        ];

        const activeAssignedJob = await db
            .selectFrom('jobs')
            .select('id')
            .where('clientId', '=', clientIdForQuery)
            .where('assignedFreelancerId', '=', freelancerIdForQuery)
            .where('jobStatus', 'in', ACTIVE_JOB_STATUSES)
            .executeTakeFirst();

        if (activeAssignedJob) {
            return NextResponse.json(
                { success: false, message: 'Cannot block user as job is assigned' },
                { status: 400 }
            );
        }

        // Check if block entry already exists
        const existing = await db
            .selectFrom('blockedUsers')
            .select('id')
            .where((eb) =>
                eb.or([
                    eb.and([
                        eb('blockerId', '=', blockerId),
                        eb('blockedId', '=', blockedId),
                    ]),
                    eb.and([
                        eb('blockerId', '=', clientIdForQuery),
                        eb('blockedId', '=', freelancerIdForQuery),
                    ]),
                    eb.and([
                        eb('blockerId', '=', freelancerIdForQuery),
                        eb('blockedId', '=', clientIdForQuery),
                    ]),
                ])
            )
            .executeTakeFirst();

        if (existing) {
            if (threadId) {
                await db.updateTable('chatThreads')
                    .set({ status: 'BLOCKED', updatedAt: new Date() })
                    .where('id', '=', threadId)
                    .execute();
            }
            return NextResponse.json(
                { success: false, isAlreadyBlocked: true, message: 'User is already blocked' },
                { status: 400 }
            );
        }

        await db
            .insertInto('blockedUsers')
            .values({
                id: crypto.randomUUID(),
                blockerId,
                blockedId,
                blockerType,
                blockedType,
                createdAt: new Date(),
            })
            .execute();

        // Always update current chat thread to BLOCKED
        if (threadId) {
            await db
                .updateTable('chatThreads')
                .set({ status: 'BLOCKED', updatedAt: new Date() })
                .where('id', '=', threadId)
                .execute();
        }

        // Update all non-active threads between these two parties to BLOCKED
        const allThreads = await db
            .selectFrom('chatThreads')
            .innerJoin('jobs', 'jobs.id', 'chatThreads.jobId')
            .select(['chatThreads.id', 'jobs.jobStatus'])
            .where('chatThreads.clientId', '=', clientIdForQuery)
            .where('chatThreads.freelancerId', '=', freelancerIdForQuery)
            .execute();

        const blockableThreadIds: string[] = [];
        for (const t of allThreads) {
            if (!ACTIVE_JOB_STATUSES.includes(t.jobStatus)) {
                blockableThreadIds.push(t.id);
            }
        }

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
