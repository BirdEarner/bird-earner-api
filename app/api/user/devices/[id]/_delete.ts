import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';
import { NextResponse } from 'next/server';

// Removes a device from the user's list. It must sign in with a two-factor code again next time.
export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const userId = await getUserIdFromRequest();
        if (!userId) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;

        const result = await db
            .deleteFrom('userDevices')
            .where('id', '=', id)
            .where('userId', '=', userId)
            .executeTakeFirst();

        if (Number(result.numDeletedRows) === 0) {
            return NextResponse.json({ success: false, message: 'Device not found' }, { status: 404 });
        }

        return NextResponse.json({ success: true, message: 'Device removed' });
    } catch (error) {
        console.error('Remove user device error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
