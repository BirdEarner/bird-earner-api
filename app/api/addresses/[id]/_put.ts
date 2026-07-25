import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { serializeAddress, toDbCoords } from '@/lib/addresses';
import { validateBody } from '@/lib/validation';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const updateAddressSchema = z.object({
    label: z.string().min(1).max(50).optional(),
    line1: z.string().min(1).max(500).optional(),
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

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const existing = await db
            .selectFrom('userAddresses')
            .select(['id', 'userId'])
            .where('id', '=', id)
            .where('userId', '=', user.id)
            .executeTakeFirst();

        if (!existing) {
            return NextResponse.json(
                { success: false, message: 'Address not found' },
                { status: 404 }
            );
        }

        const body = await request.json();
        const validation = validateBody(body, updateAddressSchema);
        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const data = validation.data;
        const now = new Date();

        if (data.isDefault) {
            await db
                .updateTable('userAddresses')
                .set({ isDefault: false, updatedAt: now })
                .where('userId', '=', user.id)
                .where('id', '!=', id)
                .execute();
        }

        const patch: Record<string, unknown> = { updatedAt: now };
        if (data.label !== undefined) patch.label = data.label;
        if (data.line1 !== undefined) patch.line1 = data.line1;
        if (data.line2 !== undefined) patch.line2 = data.line2 || null;
        if (data.city !== undefined) patch.city = data.city || null;
        if (data.state !== undefined) patch.state = data.state || null;
        if (data.zipcode !== undefined) {
            patch.zipcode = data.zipcode != null ? String(data.zipcode) : null;
        }
        if (data.country !== undefined) patch.country = data.country || 'India';
        if (data.latitude !== undefined) patch.latitude = toDbCoords(data.latitude);
        if (data.longitude !== undefined) patch.longitude = toDbCoords(data.longitude);
        if (data.isDefault !== undefined) patch.isDefault = data.isDefault;
        if (data.lastUsedAt !== undefined) {
            patch.lastUsedAt = data.lastUsedAt ? new Date(data.lastUsedAt) : null;
        }

        const row = await db
            .updateTable('userAddresses')
            .set(patch)
            .where('id', '=', id)
            .where('userId', '=', user.id)
            .returningAll()
            .executeTakeFirstOrThrow();

        return NextResponse.json({
            success: true,
            data: serializeAddress(row),
        });
    } catch (error: unknown) {
        console.error('Update address error:', error);
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : 'Server error',
            },
            { status: 500 }
        );
    }
}
