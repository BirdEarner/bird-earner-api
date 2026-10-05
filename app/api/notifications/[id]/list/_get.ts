import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { sql } from 'kysely';

// Same taxonomy as app/utils/marketplaceUtils.js + api jobs listing:
// job work type from projectType ('Remote'/'REMOTE'/'On-site'/'on-site'),
// freelancer workType from freelancers.workType ('remote'/'onsite').
const normalizeWorkType = (v?: string | null): 'remote' | 'onsite' | null => {
    if (!v) return null;
    const s = String(v).toLowerCase().trim();
    if (s === 'remote') return 'remote';
    if (s.includes('site')) return 'onsite';
    return null;
};

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthUser();
        const { id } = await params;
        const userId = id; // Map id to userId for logic

        // Optional: Add check to ensure user can only see their own notifications
        // if (user && user.id !== userId) {
        //   return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        // }

        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '20');
        const skip = (page - 1) * limit;

        // Freelancer type scope: hide notifications for jobs whose work type
        // doesn't match the freelancer's current work type (notifications are
        // role-scoped via userType, so clients/dual roles are unaffected).
        const freelancerProfile = await db
            .selectFrom('freelancers')
            .select(['workType'])
            .where('userId', '=', userId)
            .executeTakeFirst();
        const workType = normalizeWorkType(freelancerProfile?.workType);
        const typeFilter = workType
            ? sql<boolean>`NOT (notifications."userType" = 'FREELANCER' AND EXISTS (
                SELECT 1 FROM jobs j
                WHERE j.id::text = notifications.data->>'jobId'
                  AND (CASE WHEN lower(j."projectType") LIKE '%remote%' THEN 'remote' ELSE 'onsite' END) <> ${workType}
            ))`
            : sql<boolean>`true`;

        const [total, notifications, unreadCount] = await Promise.all([
            db
                .selectFrom('notifications')
                .select(({ fn }) => fn.count('id').as('count'))
                .where('userId', '=', userId)
                .where(typeFilter)
                .executeTakeFirst(),
            db
                .selectFrom('notifications')
                .selectAll()
                .where('userId', '=', userId)
                .where(typeFilter)
                .orderBy('createdAt', 'desc')
                .offset(skip)
                .limit(limit)
                .execute(),
            db
                .selectFrom('notifications')
                .select(({ fn }) => fn.count('id').as('count'))
                .where('userId', '=', userId)
                .where('isRead', '=', false)
                .where(typeFilter)
                .executeTakeFirst()
        ]);

        return NextResponse.json({
            data: notifications,
            pagination: {
                page,
                limit,
                total: Number(total?.count || 0),
                totalPages: Math.ceil(Number(total?.count || 0) / limit)
            },
            unreadCount: Number(unreadCount?.count || 0)
        });
    } catch (error: any) {
        console.error('List notifications error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
