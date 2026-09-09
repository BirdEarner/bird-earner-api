import { getAdminUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function DELETE(
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

        await db
            .deleteFrom('contacts')
            .where('id', '=', id)
            .executeTakeFirst();

        return NextResponse.json({
            success: true,
            message: 'Contact deleted successfully',
        });
    } catch (error: any) {
        console.error('Delete contact error:', error);
        return NextResponse.json({ success: false, message: error.message || 'Server error' }, { status: 500 });
    }
}
