import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        }

        await db
            .deleteFrom('notifications')
            .where('id', '=', id)
            .execute();

        return NextResponse.json({ message: 'Notification deleted' });

    } catch (error: any) {
        console.error('Delete notification error:', error);
        return NextResponse.json({ message: error.message || 'Server error' }, { status: 500 });
    }
}
