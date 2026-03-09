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
            .selectFrom('clients')
            .innerJoin('users', 'clients.userId', 'users.id')
            .select([
                'clients.id as $id',
                'clients.id',
                'clients.userId',
                'clients.organizationType as organization_type',
                'clients.companyName as company_name',
                'clients.profilePhoto as profile_photo',
                'clients.city',
                'clients.state',
                'clients.country',
                'clients.currentlyAvailable as currently_available',
                'clients.wallet',
                'clients.createdAt as $createdAt',
                'clients.createdAt',
                'users.fullName as full_name',
                'users.email',
                sql<string | null>`NULL`.as('mobile_number'),
                sql<number>`1`.as('level'),
                sql<number>`0`.as('XP')
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
            .selectFrom('clients')
            .innerJoin('users', 'clients.userId', 'users.id');

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

        const [totalResult, clients] = await Promise.all([
            filterQuery(totalQuery)
                .select(sql<number>`count(*)`.as('count'))
                .executeTakeFirst(),
            filterQuery(query)
                .orderBy('clients.createdAt', 'desc')
                .offset((page - 1) * pageSize)
                .limit(pageSize)
                .execute()
        ]);

        return NextResponse.json({
            success: true,
            message: 'Clients retrieved successfully',
            data: {
                clients,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(Number(totalResult?.count || 0) / pageSize),
                    totalItems: Number(totalResult?.count || 0),
                    itemsPerPage: pageSize
                }
            }
        });

    } catch (error: any) {
        console.error('Get clients error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
