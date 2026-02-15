import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, validateParams } from '@/lib/validation';

// Schema for updating a service
const updateServiceSchema = z.object({
    name: z.string().min(1, 'Name is required').optional(),
    category: z.enum(['FREELANCE', 'HOUSEHOLD']).optional(),
    description: z.string().optional(),
    imageUrl: z.string().optional(),
    isActive: z.boolean().optional(),
    priorityConfig: z.any().optional(),
    birdFee: z.any().optional(),
});

const paramsSchema = z.object({
    id: z.string().uuid(),
});

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const paramValidation = await validateParams(params, paramsSchema);
        if (!paramValidation.success) {
            return NextResponse.json({ message: paramValidation.error }, { status: 400 });
        }
        const { id } = paramValidation.data;

        const body = await request.json();
        const validation = await validateBody(body, updateServiceSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const data = validation.data;

        // Check if service exists
        const service = await db.selectFrom('services')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        if (!service) {
            return NextResponse.json({ message: 'Service not found' }, { status: 404 });
        }

        // Check if name is taken by another service
        if (data.name) {
            const existing = await db.selectFrom('services')
                .select('id')
                .where('name', '=', data.name)
                .where('id', '!=', id)
                .executeTakeFirst();

            if (existing) {
                return NextResponse.json({ message: 'Service with this name already exists' }, { status: 409 });
            }
        }

        const updateData: any = {
            updatedAt: new Date(),
        };

        if (data.name !== undefined) updateData.name = data.name;
        // @ts-ignore
        if (data.category !== undefined) updateData.category = data.category;
        if (data.description !== undefined) updateData.description = data.description;
        if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
        if (data.isActive !== undefined) updateData.isActive = data.isActive;
        if (data.priorityConfig !== undefined) updateData.priorityConfig = typeof data.priorityConfig === 'string' ? JSON.parse(data.priorityConfig) : data.priorityConfig;
        if (data.birdFee !== undefined) updateData.birdFee = typeof data.birdFee === 'string' ? JSON.parse(data.birdFee) : data.birdFee;

        const updatedService = await db.updateTable('services')
            .set(updateData)
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirst();

        return NextResponse.json({
            success: true,
            message: 'Service updated successfully',
            data: updatedService
        });

    } catch (error: any) {
        console.error('Update service error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}

export async function DELETE(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const paramValidation = await validateParams(params, paramsSchema);
        if (!paramValidation.success) {
            return NextResponse.json({ message: paramValidation.error }, { status: 400 });
        }
        const { id } = paramValidation.data;

        const result = await db.deleteFrom('services')
            .where('id', '=', id)
            .executeTakeFirst();

        if (result.numDeletedRows === BigInt(0)) {
            return NextResponse.json({ message: 'Service not found' }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            message: 'Service deleted successfully'
        });

    } catch (error: any) {
        console.error('Delete service error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
