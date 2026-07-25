import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { serializeAddress } from '@/lib/addresses';
import { validateBody } from '@/lib/validation';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const patchAddressSchema = z.object({
    markUsed: z.boolean().optional(),
    isDefault: z.boolean().optional(),
});

export async function PATCH(
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
            .select(['id'])
            .where('id', '=', id)
            .where('userId', '=', user.id)
            .executeTakeFirst();

        if (!existing) {
            return NextResponse.json(
                { success: false, message: 'Address not found' },
                { status: 404 }
            );
        }

        const body = await request.json().catch(() => ({}));
        const validation = validateBody(body || {}, patchAddressSchema);
        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const data = validation.data;
        const now = new Date();
        const patch: Record<string, unknown> = { updatedAt: now };

        if (data.markUsed || data.isDefault) {
            patch.lastUsedAt = now;
        }
        if (data.isDefault) {
            await db
                .updateTable('userAddresses')
                .set({ isDefault: false, updatedAt: now })
                .where('userId', '=', user.id)
                .where('id', '!=', id)
                .execute();
            patch.isDefault = true;
        } else if (data.markUsed) {
            // Selecting an address for delivery also marks it default for next time
            patch.isDefault = true;
            await db
                .updateTable('userAddresses')
                .set({ isDefault: false, updatedAt: now })
                .where('userId', '=', user.id)
                .where('id', '!=', id)
                .execute();
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
        console.error('Patch address error:', error);
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : 'Server error',
            },
            { status: 500 }
        );
    }
}
