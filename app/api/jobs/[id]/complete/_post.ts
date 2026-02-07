import { getAuthUser } from '@/lib/auth';
import { completeJob } from '@/lib/services/jobs';
import { NextResponse } from 'next/server';

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const job = await completeJob(id, user.id);

        return NextResponse.json({
            success: true,
            message: 'Job completed and payment processed successfully',
            data: job
        });
    } catch (error: any) {
        console.error('Complete job error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Failed to complete job'
        }, { status: 500 });
    }
}
