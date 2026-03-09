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
        const pageSize = Number(searchParams.get('pageSize')) || 10;
        const status = searchParams.get('status');

        const query = db
            .selectFrom('contacts')
            .selectAll();

        const totalQuery = db
            .selectFrom('contacts');

        const filterQuery = (qb: any) => {
            if (status) {
                return qb.where('status', '=', status as any);
            }
            return qb;
        };

        const [totalResult, contacts] = await Promise.all([
            filterQuery(totalQuery)
                .select(sql<number>`count(*)`.as('count'))
                .executeTakeFirst(),
            filterQuery(query)
                .orderBy('createdAt', 'desc')
                .offset((page - 1) * pageSize)
                .limit(pageSize)
                .execute()
        ]);

        return NextResponse.json({
            success: true,
            data: {
                contacts,
                total: Number(totalResult?.count || 0),
                page,
                totalPages: Math.ceil(Number(totalResult?.count || 0) / pageSize)
            }
        });

    } catch (error: any) {
        console.error('Get contacts error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
