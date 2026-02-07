import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const result = await db
            .deleteFrom('clients')
            .where('id', '=', id)
            .executeTakeFirst();

        if (Number(result.numDeletedRows) === 0) {
            return NextResponse.json({ message: 'Client not found or already deleted' }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            message: 'Client profile deleted successfully'
        });

    } catch (error: any) {
        console.error('Delete client error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 400 });
    }
}
