import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

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

        const [total, notifications, unreadCount] = await Promise.all([
            db
                .selectFrom('notifications')
                .select(({ fn }) => fn.count('id').as('count'))
                .where('userId', '=', userId)
                .executeTakeFirst(),
            db
                .selectFrom('notifications')
                .selectAll()
                .where('userId', '=', userId)
                .orderBy('createdAt', 'desc')
                .offset(skip)
                .limit(limit)
                .execute(),
            db
                .selectFrom('notifications')
                .select(({ fn }) => fn.count('id').as('count'))
                .where('userId', '=', userId)
                .where('isRead', '=', false)
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
