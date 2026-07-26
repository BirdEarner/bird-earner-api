import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { homePromoBodySchema, toPromoInsert } from '@/lib/home-promos';
import { NextRequest, NextResponse } from 'next/server';

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
            .selectFrom('homePromos')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirst();

        if (!existing) {
            return NextResponse.json({ message: 'Promo not found' }, { status: 404 });
        }

        const body = await request.json();
        const validation = homePromoBodySchema.safeParse(body);
        if (!validation.success) {
            return NextResponse.json(
                { message: validation.error.issues[0]?.message || 'Invalid body' },
                { status: 400 }
            );
        }

        const promo = await db
            .updateTable('homePromos')
            .set(toPromoInsert(validation.data))
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirstOrThrow();

        return NextResponse.json({
            success: true,
            message: 'Home promo updated',
            data: promo,
        });
    } catch (error: unknown) {
        console.error('Admin update home promo error:', error);
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
            .selectFrom('homePromos')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirst();

        if (!existing) {
            return NextResponse.json({ message: 'Promo not found' }, { status: 404 });
        }

        await db.deleteFrom('homePromos').where('id', '=', id).execute();

        return NextResponse.json({
            success: true,
            message: 'Home promo deleted',
        });
    } catch (error: unknown) {
        console.error('Admin delete home promo error:', error);
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : 'Server error',
            },
            { status: 500 }
        );
    }
}
