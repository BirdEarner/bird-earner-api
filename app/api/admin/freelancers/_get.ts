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
        const page = Number(searchParams.get('page')) || 1;
        const pageSize = Number(searchParams.get('limit')) || 8;
        const search = searchParams.get('search') || '';

        let query = db
            .selectFrom('freelancers')
            .innerJoin('users', 'freelancers.userId', 'users.id')
            .leftJoin('bankAccounts as ba', 'users.id', 'ba.userId')
            .select([
                'freelancers.id as $id',
                'freelancers.id',
                'freelancers.userId',
                'freelancers.mobileNumber as mobile_number',
                'freelancers.profilePhoto as profile_photo',
                'freelancers.city',
                'freelancers.state',
                'freelancers.country',
                'freelancers.currentlyAvailable as currently_available',
                'freelancers.totalEarnings as total_earnings',
                'freelancers.monthlyEarnings as monthly_earnings',
                'freelancers.withdrawableAmount as withdrawable_amount',
                'freelancers.selectedServices as role_designation',
                'freelancers.highestQualification as highest_qualification',
                'ba.bankName',
                'ba.accountNumber',
                'ba.ifscCode',
                'users.fullName as full_name',
                'users.email'
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
            .innerJoin('users', 'freelancers.userId', 'users.id');

        const filterQuery = (qb: any) => {
            if (search) {
                return qb.where((eb: any) =>
                    eb.or([
                        eb('users.fullName', 'ilike', `%${search}%`),
                        eb('users.email', 'ilike', `%${search}%`)
                    ])
                );
            }
            return qb;
        };

        const [totalResult, freelancers] = await Promise.all([
            filterQuery(totalQuery)
                .select(sql<number>`count(*)`.as('count'))
                .executeTakeFirst(),
            filterQuery(query)
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
