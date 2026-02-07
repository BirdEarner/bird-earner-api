import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ jobId: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { jobId } = await params;

        // Check if exists
        const existing = await db
            .selectFrom('jobBookmarks')
            .select('id')
            .where('userId', '=', user.id)
            .where('jobId', '=', jobId)
            .executeTakeFirst();

        if (existing) {
            return NextResponse.json({
                success: true,
                message: 'Job already bookmarked',
                data: existing
            });
        }

        const newBookmarkId = uuidv4();
        await db
            .insertInto('jobBookmarks')
            .values({
                id: newBookmarkId,
                userId: user.id,
                jobId: jobId,
                updatedAt: new Date()
            })
            .execute();

        return NextResponse.json({
            success: true,
            message: 'Job bookmarked successfully',
            data: { id: newBookmarkId, userId: user.id, jobId }
        }, { status: 201 });

    } catch (error: any) {
        console.error('Add bookmark error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
