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

        await db
            .updateTable('notifications')
            .set({ isRead: true, updatedAt: new Date() })
            .where('id', '=', id)
            .execute();

        return NextResponse.json({ message: "Marked as read" });
    } catch (error: any) {
        console.error('Mark notification read error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
