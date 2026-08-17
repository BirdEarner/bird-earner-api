import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const updateOfferSchema = z.object({
    amount: z.number().positive().optional(),
    amountType: z.enum(['LUMPSUM', 'PERCENT']).optional(),
    discovered: z.boolean().optional(),
    used: z.boolean().optional(),
});

export async function PUT(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const existing = await db
            .selectFrom('cashbackOffers')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirst();

        if (!existing) {
            return NextResponse.json({ message: 'Offer not found' }, { status: 404 });
        }

        const body = await request.json();
        const validation = updateOfferSchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json(
                { message: validation.error.issues[0]?.message || 'Invalid body' },
                { status: 400 }
            );
        }

        const updateData = validation.data;
        if (Object.keys(updateData).length === 0) {
            return NextResponse.json({ message: 'No fields to update' }, { status: 400 });
        }

        const offer = await db
            .updateTable('cashbackOffers')
            .set({ ...updateData, updatedAt: new Date() })
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirstOrThrow();

        return NextResponse.json({
            success: true,
            message: 'Offer updated',
            data: offer,
        });
    } catch (error: unknown) {
        console.error('Admin update cashback offer error:', error);
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : 'Server error',
            },
            { status: 500 }
        );
    }
}

export async function DELETE(
    _request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const existing = await db
            .selectFrom('cashbackOffers')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirst();

        if (!existing) {
            return NextResponse.json({ message: 'Offer not found' }, { status: 404 });
        }

        await db.deleteFrom('cashbackOffers').where('id', '=', id).execute();

        return NextResponse.json({
            success: true,
            message: 'Offer deleted',
        });
    } catch (error: unknown) {
        console.error('Admin delete cashback offer error:', error);
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : 'Server error',
            },
            { status: 500 }
        );
    }
}
