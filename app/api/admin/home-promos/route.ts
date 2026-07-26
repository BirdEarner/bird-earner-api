import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { homePromoBodySchema, toPromoInsert } from '@/lib/home-promos';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const placement = searchParams.get('placement');

        let query = db
            .selectFrom('homePromos')
            .leftJoin('services', 'services.id', 'homePromos.serviceId')
            .selectAll('homePromos')
            .select(['services.name as serviceName', 'services.category as serviceCategory'])
            .orderBy('homePromos.sortOrder', 'asc')
            .orderBy('homePromos.createdAt', 'desc');

        if (placement === 'BANNER' || placement === 'OFFER_CARD') {
            query = query.where('homePromos.placement', '=', placement);
        }

        const promos = await query.execute();

        return NextResponse.json({
            success: true,
            data: { promos },
        });
    } catch (error: unknown) {
        console.error('Admin list home promos error:', error);
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : 'Server error',
            },
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
        const validation = homePromoBodySchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json(
                { message: validation.error.issues[0]?.message || 'Invalid body' },
                { status: 400 }
            );
        }

        const now = new Date();
        const values = {
            id: crypto.randomUUID(),
            ...toPromoInsert(validation.data),
            createdAt: now,
        };

        const promo = await db
            .insertInto('homePromos')
            .values(values)
            .returningAll()
            .executeTakeFirstOrThrow();

        return NextResponse.json(
            {
                success: true,
                message: 'Home promo created',
                data: promo,
            },
            { status: 201 }
        );
    } catch (error: unknown) {
        console.error('Admin create home promo error:', error);
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : 'Server error',
            },
            { status: 500 }
        );
    }
}
