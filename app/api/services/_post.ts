import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { validateBody } from '@/lib/validation';

const createServiceSchema = z.object({
    name: z.string().min(1, "Name is required"),
    category: z.enum(['freelance', 'household']),
    description: z.string().optional(),
    icon: z.string().optional(),
    isActive: z.boolean().optional().default(true),
    platformFee: z.number().optional().default(10), // Default 10%
    priorityConfig: z.any().optional() // JSON object
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, createServiceSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const data = validation.data;
        const serviceId = uuidv4();

        await db.insertInto('services')
            .values({
                id: serviceId,
                name: data.name,
                category: data.category.toUpperCase() as any,
                description: data.description || null,
                isActive: data.isActive,
                createdAt: new Date(),
                updatedAt: new Date()
            })
            .execute();

        const service = await db
            .selectFrom('services')
            .selectAll()
            .where('id', '=', serviceId)
            .executeTakeFirst();

        return NextResponse.json({
            success: true,
            message: 'Service created successfully',
            data: service
        }, { status: 201 });

    } catch (error: any) {
        console.error('Create service error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 400 });
    }
}
