import { getAuthUser } from '@/lib/auth';
import { assignFreelancer } from '@/lib/services/jobs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const assignFreelancerSchema = z.object({
    freelancerId: z.string(),
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
        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), assignFreelancerSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const job = await assignFreelancer(id, validation.data.freelancerId, user.id);

        return NextResponse.json({
            success: true,
            message: 'Freelancer assigned successfully',
            data: job
        });
    } catch (error: any) {
        console.error('Assign freelancer error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Failed to assign freelancer'
        }, { status: 500 });
    }
}
