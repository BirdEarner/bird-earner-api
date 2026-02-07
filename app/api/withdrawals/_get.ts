import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '10');
        const skip = (page - 1) * limit;

        const freelancer = await db
            .selectFrom('freelancers')
            .select('id')
            .where('userId', '=', user.id)
            .executeTakeFirst();

        if (!freelancer) {
            return NextResponse.json({ success: true, data: { requests: [], pagination: { total: 0, page, limit, totalPages: 0 } } });
        }

        const [total, requests] = await Promise.all([
            db
                .selectFrom('withdrawalRequests')
                .select(({ fn }) => fn.count('id').as('count'))
                .where('freelancerId', '=', freelancer.id)
                .executeTakeFirst(),
            db
                .selectFrom('withdrawalRequests')
                .selectAll()
                .where('freelancerId', '=', freelancer.id)
                .orderBy('createdAt', 'desc')
                .offset(skip)
                .limit(limit)
                .execute()
        ]);

        return NextResponse.json({
            success: true,
            data: {
                requests,
                pagination: {
                    total: Number(total?.count || 0),
                    page,
                    limit,
                    totalPages: Math.ceil(Number(total?.count || 0) / limit)
                }
            }
        });
    } catch (error: any) {
        console.error('List withdrawals error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
