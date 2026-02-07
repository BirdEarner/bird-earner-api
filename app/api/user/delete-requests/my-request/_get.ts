import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';

export async function GET(request: Request) {
    try {
        const userId = await getUserIdFromRequest(request);
        if (!userId) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const deleteRequest = await db
            .selectFrom('deleteRequests')
            .selectAll()
            .where('userId', '=', userId)
            .orderBy('createdAt', 'desc')
            .executeTakeFirst();

        if (!deleteRequest) {
            return NextResponse.json({
                success: false,
                message: 'No delete request found'
            }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            data: deleteRequest
        });

    } catch (error: any) {
        console.error('Get delete request error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
