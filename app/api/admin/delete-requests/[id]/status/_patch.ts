import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: requestId } = await params;
        const adminId = await getUserIdFromRequest(request);
        if (!adminId) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { status } = await request.json();
        const validStatuses = ['PENDING', 'APPROVED', 'REJECTED'];
        if (!validStatuses.includes(status)) {
            return NextResponse.json({ success: false, message: 'Invalid status' }, { status: 400 });
        }

        const result = await db
            .updateTable('deleteRequests')
            .set({
                status: status as any,
                processedBy: adminId,
                processedAt: new Date(),
                updatedAt: new Date()
            })
            .where('id', '=', requestId)
            .returningAll()
            .executeTakeFirst();

        if (!result) {
            return NextResponse.json({ success: false, message: 'Delete request not found' }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            message: `Delete request ${status.toLowerCase()} successfully`,
            data: result
        });

    } catch (error: any) {
        console.error('Update delete request error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
