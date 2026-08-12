import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';
import { validateBody } from '@/lib/validation';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import crypto from 'crypto';

const createSuggestedServiceSchema = z.object({
    userId: z.string().uuid().optional(),
    serviceName: z.string().min(1, 'Service name is required'),
    description: z.string().optional().nullable(),
    images: z.any().optional().nullable(),
});

export async function POST(request: Request) {
    try {
        const authUserId = await getUserIdFromRequest(request);
        const body = await request.json();
        const validation = validateBody(body, createSuggestedServiceSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { userId: bodyUserId, serviceName, description, images } = validation.data;
        const targetUserId = authUserId || bodyUserId;

        if (!targetUserId) {
            return NextResponse.json({ success: false, message: 'Unauthorized. User ID is required.' }, { status: 401 });
        }

        const cleanName = serviceName.trim();

        // Check auto-matching service
        const matchingService = await db.selectFrom('services')
            .select('id')
            .where((eb) => eb.fn('LOWER', ['name']), '=', cleanName.toLowerCase())
            .executeTakeFirst();

        const suggestionId = crypto.randomUUID();
        const status = matchingService ? 'match' : 'pending';
        const matchedServiceId = matchingService ? matchingService.id : null;
        const formattedImages = images ? (typeof images === 'string' ? images : JSON.stringify(images)) : null;

        // @ts-ignore
        await db.insertInto('suggestedServices').values({
            id: suggestionId,
            userId: targetUserId,
            serviceName: cleanName,
            description: description || null,
            images: formattedImages,
            status,
            matchedServiceId,
            updatedAt: new Date(),
        }).execute();

        const inserted = await db.selectFrom('suggestedServices')
            .selectAll()
            .where('id', '=', suggestionId)
            .executeTakeFirst();

        return NextResponse.json({
            success: true,
            message: matchingService
                ? 'Suggested service matched an existing service!'
                : 'Suggested service submitted successfully for Super Admin approval.',
            data: inserted,
        }, { status: 201 });

    } catch (error: any) {
        console.error('Error creating suggested service:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error creating suggested service',
        }, { status: 500 });
    }
}
