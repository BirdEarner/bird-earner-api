import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const service = await db
            .selectFrom('services')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        if (!service) {
            return NextResponse.json({
                success: false,
                message: 'Service not found'
            }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            message: 'Service retrieved successfully',
            data: service
        });

    } catch (error: any) {
        console.error('Get service error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
