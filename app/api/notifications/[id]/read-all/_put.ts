import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const userId = id; // Map id to userId for logic

        const result = await db
            .updateTable('notifications')
            .set({ isRead: true, updatedAt: new Date() })
            .where('userId', '=', userId)
            .where('isRead', '=', false)
            .execute();

        return NextResponse.json({
            message: "All marked as read",
            count: Number(result[0].numUpdatedRows)
        });
    } catch (error: any) {
        console.error('Mark all notifications read error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
