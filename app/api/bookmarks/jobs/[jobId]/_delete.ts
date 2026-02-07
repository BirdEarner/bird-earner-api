import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ jobId: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { jobId } = await params;

        const result = await db
            .deleteFrom('jobBookmarks')
            .where('userId', '=', user.id)
            .where('jobId', '=', jobId)
            .executeTakeFirst();

        if (Number(result.numDeletedRows) === 0) {
            return NextResponse.json({
                success: false,
                message: 'Bookmark not found'
            }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            message: 'Job bookmark removed successfully'
        });

    } catch (error: any) {
        console.error('Remove bookmark error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
