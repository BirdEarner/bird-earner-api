import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';
import { sql } from 'kysely';

export async function GET(request: Request) {
    try {
        // Verify admin authentication
        const userId = await getUserIdFromRequest(request);
        if (!userId) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const page = Number(searchParams.get('page')) || 1;
        const pageSize = Number(searchParams.get('pageSize')) || 10;
        const status = searchParams.get('status');

        let query = db
            .selectFrom('deleteRequests')
            .innerJoin('users', 'deleteRequests.userId', 'users.id')
            .select([
                'deleteRequests.id',
                'deleteRequests.userId',
                'deleteRequests.userType',
                'deleteRequests.reason',
                'deleteRequests.status',
                'deleteRequests.createdAt',
                'deleteRequests.updatedAt',
                'deleteRequests.processedAt',
                'deleteRequests.processedBy',
                'users.fullName',
                'users.email'
            ]);

        if (status) {
            query = query.where('deleteRequests.status', '=', status as any);
        }

        const totalQuery = db
            .selectFrom('deleteRequests')
            .select(sql<number>`count(*)`.as('count'));

        const [totalResult, requests] = await Promise.all([
            totalQuery.executeTakeFirst(),
            query
                .orderBy('deleteRequests.createdAt', 'desc')
                .offset((page - 1) * pageSize)
                .limit(pageSize)
                .execute()
        ]);

        return NextResponse.json({
            success: true,
            data: {
                deleteRequests: requests,
                total: Number(totalResult?.count || 0),
                page,
                totalPages: Math.ceil(Number(totalResult?.count || 0) / pageSize)
            }
        });

    } catch (error: any) {
        console.error('Delete requests list error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
