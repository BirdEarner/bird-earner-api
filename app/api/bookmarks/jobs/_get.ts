import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { jsonArrayFrom } from 'kysely/helpers/postgres';

export async function GET(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '10');
        const offset = (page - 1) * limit;

        const bookmarks = await db
            .selectFrom('jobBookmarks')
            .innerJoin('jobs', 'jobs.id', 'jobBookmarks.jobId')
            .selectAll('jobs') // Select all job fields
            .select((eb) => [
                'jobBookmarks.createdAt as bookmarkedAt',
                // Include service details
                jsonArrayFrom(
                    eb.selectFrom('services')
                        .select(['id', 'name', 'category'])
                        .whereRef('services.id', '=', 'jobs.serviceId')
                ).as('service'),
                // Include client details
                jsonArrayFrom(
                    eb.selectFrom('clients')
                        .innerJoin('users', 'users.id', 'clients.userId')
                        .select(['clients.id', 'clients.companyName', 'users.fullName', 'users.email'])
                        .whereRef('clients.id', '=', 'jobs.clientId')
                ).as('client')
            ])
            .where('jobBookmarks.userId', '=', user.id)
            .orderBy('jobBookmarks.createdAt', 'desc')
            .limit(limit)
            .offset(offset)
            .execute();

        // Transform results to match expected structure (unwrap arrays from jsonArrayFrom)
        const transformedBookmarks = bookmarks.map(b => ({
            ...b,
            service: b.service && b.service[0] ? b.service[0] : null,
            client: b.client && b.client[0] ? {
                ...b.client[0],
                user: {
                    fullName: b.client[0].fullName,
                    email: b.client[0].email
                }
            } : null
        }));

        const totalResult = await db
            .selectFrom('jobBookmarks')
            .select(db.fn.count('id').as('count'))
            .where('userId', '=', user.id)
            .executeTakeFirst();

        const total = Number(totalResult?.count || 0);

        return NextResponse.json({
            success: true,
            message: 'Bookmarked jobs retrieved successfully',
            data: transformedBookmarks,
            pagination: {
                total,
                page,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error: any) {
        console.error('List bookmarks error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
