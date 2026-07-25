import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { serializeAddress, toDbCoords } from '@/lib/addresses';
import { validateBody } from '@/lib/validation';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const createAddressSchema = z.object({
    label: z.string().min(1).max(50).default('Home'),
    line1: z.string().min(1).max(500),
    line2: z.string().max(500).optional().nullable(),
    city: z.string().max(100).optional().nullable(),
    state: z.string().max(100).optional().nullable(),
    zipcode: z.union([z.string(), z.number()]).optional().nullable(),
    country: z.string().max(100).optional().nullable(),
    latitude: z.number().optional().nullable(),
    longitude: z.number().optional().nullable(),
    isDefault: z.boolean().optional(),
    lastUsedAt: z.union([z.number(), z.string(), z.date()]).optional().nullable(),
});

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = validateBody(body, createAddressSchema);
        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const data = validation.data;
        const now = new Date();
        const lastUsedAt = data.lastUsedAt
            ? new Date(data.lastUsedAt)
            : data.isDefault
              ? now
              : null;

        if (data.isDefault) {
            await db
                .updateTable('userAddresses')
                .set({ isDefault: false, updatedAt: now })
                .where('userId', '=', user.id)
                .execute();
        }

        const row = await db
            .insertInto('userAddresses')
            .values({
                id: crypto.randomUUID(),
                userId: user.id,
                label: data.label || 'Home',
                line1: data.line1,
                line2: data.line2 || null,
                city: data.city || null,
                state: data.state || null,
                zipcode: data.zipcode != null ? String(data.zipcode) : null,
                country: data.country || 'India',
                latitude: toDbCoords(data.latitude ?? null),
                longitude: toDbCoords(data.longitude ?? null),
                isDefault: Boolean(data.isDefault),
                lastUsedAt,
                createdAt: now,
                updatedAt: now,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        return NextResponse.json(
            {
                success: true,
                data: serializeAddress(row),
            },
            { status: 201 }
        );
    } catch (error: unknown) {
        console.error('Create address error:', error);
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : 'Server error',
            },
            { status: 500 }
        );
    }
}
