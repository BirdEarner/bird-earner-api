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
        const page = parseInt(searchParams.get('page') || '1');
        const pageSize = parseInt(searchParams.get('pageSize') || '8');
        const status = searchParams.get('status');
        const search = searchParams.get('search') || '';

        let query = db
            .selectFrom('withdrawalRequests')
            .innerJoin('freelancers', 'withdrawalRequests.freelancerId', 'freelancers.id')
            .innerJoin('users', 'freelancers.userId', 'users.id')
            .leftJoin('bankAccounts', 'users.id', 'bankAccounts.userId')
            .select([
                'withdrawalRequests.id',
                'withdrawalRequests.amount',
                'withdrawalRequests.status',
                'withdrawalRequests.createdAt as requestDate',
                'users.fullName as freelancer',
                'users.email as freelancerEmail',
                'bankAccounts.bankName',
                'bankAccounts.accountHolderName',
                'bankAccounts.accountNumber',
                'bankAccounts.ifscCode'
            ]);

        if (status && status !== 'all') {
            query = query.where('withdrawalRequests.status', '=', status as any);
        }

        if (search) {
            query = query.where('users.fullName', 'ilike', `%${search}%`);
        }

        const totalQuery = db
            .selectFrom('withdrawalRequests')
            .innerJoin('freelancers', 'withdrawalRequests.freelancerId', 'freelancers.id')
            .innerJoin('users', 'freelancers.userId', 'users.id')
            .select(sql<number>`count(*)`.as('count'));

        const [totalResult, requests] = await Promise.all([
            totalQuery.executeTakeFirst(),
            query
                .orderBy('withdrawalRequests.createdAt', 'desc')
                .offset((page - 1) * pageSize)
                .limit(pageSize)
                .execute()
        ]);

        return NextResponse.json({
            success: true,
            total: Number(totalResult?.count || 0),
            page,
            pageSize,
            requests: requests.map(r => ({
                id: r.id,
                amount: r.amount,
                status: r.status,
                requestDate: r.requestDate,
                freelancer: r.freelancer,
                freelancerEmail: r.freelancerEmail,
                bankAccount: r.bankName ? {
                    bankName: r.bankName,
                    accountHolderName: r.accountHolderName,
                    accountNumber: r.accountNumber,
                    ifscCode: r.ifscCode
                } : null
            }))
        });

    } catch (error: any) {
        console.error('Withdrawal requests error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
