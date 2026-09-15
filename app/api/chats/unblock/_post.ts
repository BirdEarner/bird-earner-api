import { getAuthUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const unblockSchema = z.object({
    threadId: z.string().optional(),
    userId: z.string().optional(),
    blockedUserId: z.string().optional(),
});

export async function POST(request: Request) {
    try {
        const authUser = await getAuthUser();
        if (!authUser) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const parsed = unblockSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { success: false, message: parsed.error.issues[0]?.message || 'Invalid input' },
                { status: 400 }
            );
        }

        const { threadId } = parsed.data;

        if (threadId) {
            const thread = await db
                .selectFrom('chatThreads')
                .select(['id', 'clientId', 'freelancerId', 'isAccepted'])
                .where('id', '=', threadId)
                .executeTakeFirst();

            if (thread) {
                // Remove block records between these two profiles
                await db
                    .deleteFrom('blockedUsers')
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
                    .execute();

                // Restore chat thread status
                const restoredStatus = thread.isAccepted ? 'ACCEPTED' : 'OPEN';
                await db
                    .updateTable('chatThreads')
                    .set({ status: restoredStatus, updatedAt: new Date() })
                    .where('id', '=', thread.id)
                    .execute();
            }
        }

        return NextResponse.json({
            success: true,
            message: 'User unblocked successfully',
        });
    } catch (error: any) {
        console.error('Unblock user error:', error);
        return NextResponse.json(
            { success: false, message: error.message || 'Server error while unblocking user' },
            { status: 500 }
        );
    }
}
