import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateBody, validateParams } from '@/lib/validation';

// Schema for listing services
const listServicesSchema = z.object({
    page: z.string().optional().transform(v => parseInt(v || '1', 10)),
    limit: z.string().optional().transform(v => parseInt(v || '8', 10)),
    search: z.string().optional(),
    category: z.string().optional().transform(v => v ? v.toUpperCase() : undefined),
});

// Schema for creating a service
const createServiceSchema = z.object({
    name: z.string().min(1, 'Name is required'),
    category: z.enum(['FREELANCE', 'HOUSEHOLD']),
    description: z.string().optional(),
    imageUrl: z.string().optional(),
    isActive: z.boolean().optional().default(true),
    priorityConfig: z.any().optional(),
    birdFee: z.any().optional(),
});

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const params = Object.fromEntries(searchParams.entries());

        const validation = await validateParams(Promise.resolve(params), listServicesSchema);
        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { page = 1, limit = 8, search, category } = validation.data;
        const offset = (page - 1) * limit;

        let baseQuery = db.selectFrom('services');

        // Apply filters
        if (search) {
            baseQuery = baseQuery.where((eb) => eb.or([
                eb('name', 'ilike', `%${search}%`),
                eb('description', 'ilike', `%${search}%`)
            ]));
        }

        if (category) {
            // @ts-ignore - Kysely type check for enum
            baseQuery = baseQuery.where('category', '=', category);
        }

        // Get total count for pagination
        const countResult = await baseQuery
            .select((eb) => eb.fn.count<string>('id').as('count'))
            .executeTakeFirst();

        const totalServices = parseInt(countResult?.count || '0', 10);
        const totalPages = Math.ceil(totalServices / limit);

        // Get paginated data
        const services = await baseQuery
            .selectAll()
            .orderBy('createdAt', 'desc')
            .limit(limit)
            .offset(offset)
            .execute();

        return NextResponse.json({
            success: true,
            message: 'Services retrieved successfully',
            data: {
                services,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalServices
                }
            }
        });

    } catch (error: any) {
        console.error('List services error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const validation = await validateBody(body, createServiceSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const data = validation.data;

        // Check if service with name already exists
        const existing = await db.selectFrom('services')
            .select('id')
            .where('name', '=', data.name)
            .executeTakeFirst();

        if (existing) {
            return NextResponse.json({ message: 'Service with this name already exists' }, { status: 409 });
        }

        const newService = await db.insertInto('services')
            .values({
                id: crypto.randomUUID(),
                name: data.name,
                // @ts-ignore
                category: data.category,
                description: data.description,
                imageUrl: data.imageUrl,
                isActive: data.isActive,
                priorityConfig: typeof data.priorityConfig === 'string' ? JSON.parse(data.priorityConfig) : data.priorityConfig,
                birdFee: typeof data.birdFee === 'string' ? JSON.parse(data.birdFee) : data.birdFee,
                updatedAt: new Date(),
            })
            .returningAll()
            .executeTakeFirst();

        return NextResponse.json({
            success: true,
            message: 'Service created successfully',
            data: newService
        }, { status: 201 });

    } catch (error: any) {
        console.error('Create service error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
