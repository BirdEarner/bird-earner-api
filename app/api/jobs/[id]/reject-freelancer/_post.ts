import { getAuthUser } from '@/lib/auth';
import { rejectFreelancer } from '@/lib/services/jobs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const rejectFreelancerSchema = z.object({
    freelancerId: z.string(),
    threadId: z.string().optional(),
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
        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), rejectFreelancerSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { freelancerId, threadId } = validation.data;
        const thread = await rejectFreelancer(id, freelancerId, threadId, user.id);

        return NextResponse.json({
            success: true,
            message: 'Freelancer rejected successfully',
            data: thread
        });
    } catch (error: any) {
        console.error('Reject freelancer error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Failed to reject freelancer'
        }, { status: 500 });
    }
}
