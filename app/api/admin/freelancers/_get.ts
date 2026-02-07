import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';
import { sql } from 'kysely';

export async function GET(request: Request) {
    try {
        const userId = await getUserIdFromRequest(request);
        if (!userId) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const page = Number(searchParams.get('page')) || 1;
        const pageSize = Number(searchParams.get('limit')) || 8;
        const search = searchParams.get('search') || '';

        let query = db
            .selectFrom('freelancers')
            .innerJoin('users', 'freelancers.userId', 'users.id')
            .leftJoin('bankAccounts', 'users.id', 'bankAccounts.userId')
            .select([
                'freelancers.id',
                'freelancers.userId',
                'freelancers.mobileNumber',
                'freelancers.profilePhoto',
                'freelancers.city',
                'freelancers.state',
                'freelancers.country',
                'freelancers.currentlyAvailable',
                'freelancers.totalEarnings',
                'freelancers.withdrawableAmount',
                'freelancers.createdAt',
                'users.fullName',
                'users.email',
                'bankAccounts.bankName',
                'bankAccounts.accountNumber',
                'bankAccounts.ifscCode'
            ]);

        if (search) {
            query = query.where((eb) =>
                eb.or([
                    eb('users.fullName', 'ilike', `%${search}%`),
                    eb('users.email', 'ilike', `%${search}%`)
                ])
            );
        }

        const totalQuery = db
            .selectFrom('freelancers')
            .innerJoin('users', 'freelancers.userId', 'users.id')
            .select(sql<number>`count(*)`.as('count'));

        const [totalResult, freelancers] = await Promise.all([
            totalQuery.executeTakeFirst(),
            query
                .orderBy('freelancers.createdAt', 'desc')
                .offset((page - 1) * pageSize)
                .limit(pageSize)
                .execute()
        ]);

        return NextResponse.json({
            success: true,
            message: 'Freelancers retrieved successfully',
            data: {
                freelancers,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(Number(totalResult?.count || 0) / pageSize),
                    totalItems: Number(totalResult?.count || 0),
                    itemsPerPage: pageSize
                }
            }
        });

    } catch (error: any) {
        console.error('Get freelancers error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
