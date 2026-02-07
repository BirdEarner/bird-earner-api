import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;

        const freelancer = await db
            .selectFrom('freelancers')
            .select('id')
            .where('userId', '=', user.id)
            .executeTakeFirst();

        if (!freelancer) {
            return NextResponse.json({ success: false, message: 'Freelancer profile not found' }, { status: 404 });
        }

        const withdrawalRequest = await db
            .selectFrom('withdrawalRequests')
            .selectAll()
            .where('id', '=', id)
            .where('freelancerId', '=', freelancer.id)
            .executeTakeFirst();

        if (!withdrawalRequest) {
            return NextResponse.json({ success: false, message: 'Withdrawal request not found' }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            data: withdrawalRequest
        });
    } catch (error: any) {
        console.error('Get withdrawal error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
