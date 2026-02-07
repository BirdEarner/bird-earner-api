import { getAuthUser } from '@/lib/auth';
import { cancelJob } from '@/lib/services/jobs';
import { NextResponse } from 'next/server';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const job = await cancelJob(id, user.id);

        return NextResponse.json({
            success: true,
            message: 'Job cancelled successfully',
            data: job
        });
    } catch (error: any) {
        console.error('Cancel job error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Failed to cancel job'
        }, { status: 500 });
    }
}
