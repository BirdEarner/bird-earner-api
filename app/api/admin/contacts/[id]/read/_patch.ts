import { getAdminUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        if (!id) {
            return NextResponse.json({ success: false, message: 'Contact ID is required' }, { status: 400 });
        }

        const updated = await db
            .updateTable('contacts')
            .set({
                isRead: true,
                status: 'resolved',
                adminId: admin.id,
                updatedAt: new Date(),
            })
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirst();

        if (!updated) {
            return NextResponse.json({ success: false, message: 'Contact not found' }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            message: 'Marked as read and resolved',
            data: updated,
        });
    } catch (error: any) {
        console.error('Mark contact read error:', error);
        return NextResponse.json({ success: false, message: error.message || 'Server error' }, { status: 500 });
    }
}
