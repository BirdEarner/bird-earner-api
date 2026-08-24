import { getAuthUser } from '@/lib/auth';
import { extendApplicationDeadline } from '@/lib/services/jobs';
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
        const job = await extendApplicationDeadline(id, user.id);

        return NextResponse.json({
            success: true,
            message: 'Application deadline extended by 24 hours successfully',
            data: job,
        });
    } catch (error: any) {
        console.error('Extend application deadline error:', error);
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to extend application deadline' },
            { status: 500 }
        );
    }
}
