import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();

        const result = await db
            .updateTable('services')
            .set({
                name: body.name,
                category: body.category, // Enum: 'freelance' | 'household'
                description: body.description,
                icon: body.icon,
                isActive: body.isActive,
                platformFee: body.platformFee,
                priorityConfig: body.priorityConfig ? JSON.stringify(body.priorityConfig) : undefined,
                updatedAt: new Date()
            })
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirst();

        if (!result) {
            return NextResponse.json({
                success: false,
                message: 'Service not found'
            }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            message: 'Service updated successfully',
            data: result
        });

    } catch (error: any) {
        console.error('Update service error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 400 }); // Likely validation or DB error
    }
}
