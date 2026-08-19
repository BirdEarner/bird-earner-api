import { getAuthUser } from '@/lib/auth';
import { cancelJob } from '@/lib/services/jobs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const cancelSchema = z.object({
    reason: z.string().optional(),
});

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
        const body = await request.json().catch(() => ({}));
        const validation = await validateParams(Promise.resolve(body), cancelSchema);

        const reason = validation.success ? validation.data.reason : undefined;
        const job = await cancelJob(id, user.id, reason);

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
