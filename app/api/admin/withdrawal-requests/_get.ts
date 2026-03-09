import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { sql } from 'kysely';

export async function GET(request: Request) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
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

        const totalQuery = db
            .selectFrom('withdrawalRequests')
            .innerJoin('freelancers', 'withdrawalRequests.freelancerId', 'freelancers.id')
            .innerJoin('users', 'freelancers.userId', 'users.id');

        const filterQuery = (qb: any) => {
            let filtered = qb;
            if (status && status !== 'all') {
                filtered = filtered.where('withdrawalRequests.status', '=', status as any);
            }
            if (search) {
                filtered = filtered.where('users.fullName', 'ilike', `%${search}%`);
            }
            return filtered;
        };

        const [totalResult, requests] = await Promise.all([
            filterQuery(totalQuery)
                .select(sql<number>`count(*)`.as('count'))
                .executeTakeFirst(),
            filterQuery(query)
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
            requests: requests.map((r: any) => ({
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
