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
            .selectFrom('clients')
            .innerJoin('users', 'clients.userId', 'users.id')
            .select([
                'clients.id',
                'clients.userId',
                'clients.organizationType',
                'clients.companyName',
                'clients.profilePhoto',
                'clients.city',
                'clients.state',
                'clients.country',
                'clients.currentlyAvailable',
                'clients.wallet',
                'clients.createdAt',
                'users.fullName',
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
            .selectFrom('clients')
            .innerJoin('users', 'clients.userId', 'users.id')
            .select(sql<number>`count(*)`.as('count'));

        const [totalResult, clients] = await Promise.all([
            totalQuery.executeTakeFirst(),
            query
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
