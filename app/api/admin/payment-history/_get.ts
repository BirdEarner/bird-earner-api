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
        const pageSize = Number(searchParams.get('pageSize')) || 8;
        const search = searchParams.get('search') || '';

        let query = db
            .selectFrom('walletTransactions')
            .innerJoin('users', 'walletTransactions.userId', 'users.id')
            .leftJoin('jobs', 'walletTransactions.jobId', 'jobs.id')
            .leftJoin('clients', 'users.id', 'clients.userId')
            .leftJoin('freelancers', 'users.id', 'freelancers.userId')
            .select([
                'walletTransactions.id',
                'walletTransactions.amount',
                'walletTransactions.transactionType',
                'walletTransactions.description',
                'walletTransactions.referenceId',
                'walletTransactions.balanceBefore',
                'walletTransactions.balanceAfter',
                'walletTransactions.createdAt as date',
                'users.fullName as userName',
                'users.email as userEmail',
                'jobs.jobTitle',
                sql<string>`case when clients.id is not null then 'CLIENT' when freelancers.id is not null then 'FREELANCER' else 'USER' end`.as('userType')
            ]);

        if (search) {
            query = query.where((eb) =>
                eb.or([
                    eb('users.fullName', 'ilike', `%${search}%`),
                    eb('walletTransactions.referenceId', 'ilike', `%${search}%`)
                ])
            );
        }

        const totalQuery = db
            .selectFrom('walletTransactions')
            .innerJoin('users', 'walletTransactions.userId', 'users.id')
            .select(sql<number>`count(*)`.as('count'));

        const [totalResult, transactions] = await Promise.all([
            totalQuery.executeTakeFirst(),
            query
                .orderBy('walletTransactions.createdAt', 'desc')
                .offset((page - 1) * pageSize)
                .limit(pageSize)
                .execute()
        ]);

        return NextResponse.json({
            success: true,
            total: Number(totalResult?.count || 0),
            page,
            pageSize,
            payments: transactions.map((t) => ({
                id: t.id,
                transactionId: t.referenceId || `TXN-${t.id.slice(-8)}`,
                amount: t.amount,
                status: Number(t.amount) !== 0 ? 'COMPLETED' : 'PENDING',
                paymentMethod: t.transactionType,
                description: t.description,
                date: t.date,
                userName: t.userName,
                userEmail: t.userEmail,
                userType: t.userType,
                jobTitle: t.jobTitle || null,
                transactionType: t.transactionType,
                balanceBefore: t.balanceBefore,
                balanceAfter: t.balanceAfter,
            }))
        });

    } catch (error: any) {
        console.error('Payment history error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
