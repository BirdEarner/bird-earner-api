import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ jobId: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { jobId } = await params;

        const bookmark = await db
            .selectFrom('jobBookmarks')
            .select('id')
            .where('userId', '=', user.id)
            .where('jobId', '=', jobId)
            .executeTakeFirst();

        return NextResponse.json({
            success: true,
            data: { bookmarked: !!bookmark }
        });

    } catch (error: any) {
        console.error('Check bookmark status error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
