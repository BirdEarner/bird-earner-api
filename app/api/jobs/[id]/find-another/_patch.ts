import { getAuthUser } from '@/lib/auth';
import { findAnotherFreelancer } from '@/lib/services/jobs';
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
        const job = await findAnotherFreelancer(id, user.id);

        return NextResponse.json({
            success: true,
            message: 'Job reopened for other freelancers',
            data: job
        });
    } catch (error) {
        console.error('Find another freelancer error:', error);
        return NextResponse.json({
            success: false,
            message: error instanceof Error ? error.message : 'Failed to reopen job'
        }, { status: 400 });
    }
}
