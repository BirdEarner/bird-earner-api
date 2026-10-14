import { getAuthUser } from '@/lib/auth';
import { cancelJob } from '@/lib/services/jobs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

/** Service messages that describe a refused cancellation, not a server fault */
const EXPECTED_REFUSAL = /can no longer be cancelled|Normal cancellation|already arrived|already been submitted|reason is required|raise a dispute/i;

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
        const message: string = error.message || 'Failed to cancel job';

        // Expected refusals from the service are client errors, not server failures
        if (message.startsWith('Unauthorized')) {
            return NextResponse.json({ success: false, message }, { status: 403 });
        }
        if (message === 'Job not found') {
            return NextResponse.json({ success: false, message }, { status: 404 });
        }
        if (EXPECTED_REFUSAL.test(message)) {
            return NextResponse.json({ success: false, message }, { status: 400 });
        }

        console.error('Cancel job error:', error);
        return NextResponse.json({
            success: false,
            message
        }, { status: 500 });
    }
}
