import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { adminOfferUpdateSchema } from '@/lib/admin-offers';
import { NextRequest, NextResponse } from 'next/server';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }
        const { id } = await params;

        const body = await request.json();
        const parsed = adminOfferUpdateSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { success: false, message: parsed.error.issues[0]?.message || 'Invalid payload' },
                { status: 400 }
            );
        }

        const existing = await db
            .selectFrom('adminOffers')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirst();
        if (!existing) {
            return NextResponse.json({ success: false, message: 'Offer not found' }, { status: 404 });
        }

        const updates: Record<string, unknown> = { updatedAt: new Date() };
        const data = parsed.data;
        if (data.code !== undefined) updates.code = data.code.toUpperCase();
        if (data.serviceId !== undefined) updates.serviceId = data.serviceId;
        if (data.amount !== undefined) updates.amount = data.amount;
        if (data.amountType !== undefined) updates.amountType = data.amountType;
        if (data.minBooking !== undefined) updates.minBooking = data.minBooking;
        if (data.maxDiscount !== undefined) updates.maxDiscount = data.maxDiscount;
        if (data.placement !== undefined) updates.placement = data.placement;
        if (data.isActive !== undefined) updates.isActive = data.isActive;

        await db.updateTable('adminOffers').set(updates).where('id', '=', id).execute();
        return NextResponse.json({ success: true, message: 'Offer updated' });
    } catch (error: unknown) {
        console.error('Admin update offer error:', error);
        return NextResponse.json(
            { success: false, message: error instanceof Error ? error.message : 'Server error' },
            { status: 500 }
        );
    }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }
        const { id } = await params;

        const existing = await db
            .selectFrom('adminOffers')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirst();
        if (!existing) {
            return NextResponse.json({ success: false, message: 'Offer not found' }, { status: 404 });
        }

        // Claims cascade-delete; already-revealed cashbackOffers coupons survive untouched
        await db.deleteFrom('adminOffers').where('id', '=', id).execute();
        return NextResponse.json({ success: true, message: 'Offer deleted' });
    } catch (error: unknown) {
        console.error('Admin delete offer error:', error);
        return NextResponse.json(
            { success: false, message: error instanceof Error ? error.message : 'Server error' },
            { status: 500 }
        );
    }
}
