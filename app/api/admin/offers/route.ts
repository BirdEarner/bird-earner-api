import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { adminOfferBodySchema } from '@/lib/admin-offers';
import { NextRequest, NextResponse } from 'next/server';

export async function GET() {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const rows = await db
            .selectFrom('adminOffers')
            .leftJoin('services', 'services.id', 'adminOffers.serviceId')
            .selectAll('adminOffers')
            .select(['services.name as serviceName'])
            .orderBy('adminOffers.createdAt', 'desc')
            .execute();

        return NextResponse.json({ success: true, data: { offers: rows } });
    } catch (error: unknown) {
        console.error('Admin list offers error:', error);
        return NextResponse.json(
            { success: false, message: error instanceof Error ? error.message : 'Server error' },
            { status: 500 }
        );
    }
}

export async function POST(request: NextRequest) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const parsed = adminOfferBodySchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                { success: false, message: parsed.error.issues[0]?.message || 'Invalid payload' },
                { status: 400 }
            );
        }
        const data = parsed.data;

        const service = await db
            .selectFrom('services')
            .select(['id', 'name'])
            .where('id', '=', data.serviceId)
            .executeTakeFirst();
        if (!service) {
            return NextResponse.json({ success: false, message: 'Service not found' }, { status: 400 });
        }

        const existing = await db
            .selectFrom('adminOffers')
            .select('id')
            .where('code', '=', data.code.toUpperCase())
            .executeTakeFirst();
        if (existing) {
            return NextResponse.json(
                { success: false, message: 'Coupon code already exists' },
                { status: 400 }
            );
        }

        const now = new Date();
        const row = {
            id: crypto.randomUUID(),
            code: data.code.toUpperCase(),
            serviceId: data.serviceId,
            amount: data.amount,
            amountType: data.amountType,
            minBooking: data.minBooking ?? 0,
            maxDiscount: data.maxDiscount ?? null,
            placement: data.placement ?? 'OFFER_CARD' as const,
            isActive: data.isActive ?? true,
            updatedAt: now,
        };
        await db.insertInto('adminOffers').values(row).execute();

        return NextResponse.json({
            success: true,
            message: 'Offer created',
            data: { offer: { ...row, createdAt: now, serviceName: service.name } },
        });
    } catch (error: unknown) {
        console.error('Admin create offer error:', error);
        return NextResponse.json(
            { success: false, message: error instanceof Error ? error.message : 'Server error' },
            { status: 500 }
        );
    }
}
