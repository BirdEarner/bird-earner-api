import { getAuthUser } from '@/lib/auth';
import { reportFreelancerNonSubmission } from '@/lib/services/jobs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const reportSchema = z.object({
    reason: z.string().max(500).optional(),
});

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
        const body = await request.json().catch(() => ({}));
        const validation = await validateParams(Promise.resolve(body), reportSchema);

        const reason = validation.success ? validation.data.reason : undefined;
        const job = await reportFreelancerNonSubmission(id, user.id, reason);

        return NextResponse.json({
            success: true,
            message: 'Freelancer reported for no submission. Job closed with full refund.',
            data: job
        });
    } catch (error) {
        console.error('Report no-submission error:', error);
        const message = error instanceof Error ? error.message : 'Failed to report freelancer';
        return NextResponse.json({
            success: false,
            message
        }, { status: 500 });
    }
}
