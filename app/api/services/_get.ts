import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const listServicesSchema = z.object({
    category: z.enum(['freelance', 'household']).optional().transform(v => v ? v.toUpperCase() as 'FREELANCE' | 'HOUSEHOLD' : undefined),
    isActive: z.string().optional().transform(v => v === 'true' || v !== 'false') // Default to true if not specified as false
});

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const params = Object.fromEntries(searchParams.entries());

        const validation = await validateParams(Promise.resolve(params), listServicesSchema);
        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { category, isActive } = validation.data;

        let query = db.selectFrom('services').selectAll();

        if (category) {
            query = query.where('category', '=', category);
        }

        // Only filter by isActive if explicitly checked (legacy logic seems to imply this)
        if (isActive !== undefined) {
            query = query.where('isActive', '=', isActive);
        }

        const services = await query
            .orderBy('createdAt', 'desc')
            .execute();

        return NextResponse.json({
            success: true,
            message: 'Services retrieved successfully',
            data: services
        });

    } catch (error: any) {
        console.error('List services error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
