import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id: freelancerId } = await params;
        const adminId = await getUserIdFromRequest(request);
        if (!adminId) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { currently_available } = await request.json();

        const result = await db
            .updateTable('freelancers')
            .set({
                currentlyAvailable: currently_available,
                updatedAt: new Date()
            })
            .where('id', '=', freelancerId)
            .returningAll()
            .executeTakeFirst();

        if (!result) {
            return NextResponse.json({ success: false, message: 'Freelancer not found' }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            message: `Freelancer ${currently_available ? 'activated' : 'deactivated'} successfully`,
            data: {
                id: result.id,
                currently_available: result.currentlyAvailable,
                updated_at: result.updatedAt
            }
        });

    } catch (error: any) {
        console.error('Update freelancer availability error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
