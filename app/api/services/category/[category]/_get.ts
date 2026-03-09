import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

// Explicitly define Category type aligning with DB/Zod 
const CategoryEnum = z.enum(['FREELANCE', 'HOUSEHOLD']);

export async function GET(
    request: Request,
    { params }: { params: Promise<{ category: string }> }
) {
    try {
        const { category } = await params;

        // Validation (manual check as param is string)
        if (!['FREELANCE', 'HOUSEHOLD'].includes(category)) {
            return NextResponse.json({
                success: false,
                message: 'Invalid category. Must be either "FREELANCE" or "HOUSEHOLD"'
            }, { status: 400 });
        }

        const services = await db
            .selectFrom('services')
            .selectAll()
            .where('category', '=', category as any) // Type assertion for Kysely enum
            .orderBy('name', 'asc')
            .execute();

        return NextResponse.json({
            success: true,
            message: `${category} services retrieved successfully`,
            data: services
        });

    } catch (error: any) {
        console.error('Get services by category error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
