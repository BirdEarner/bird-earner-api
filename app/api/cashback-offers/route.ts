import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
    try {
        const offers = await db
            .selectFrom('cashbackOffers')
            .selectAll()
            .where('used', '=', false)
            .orderBy('createdAt', 'desc')
            .execute();

        return NextResponse.json({
            success: true,
            data: offers
        });

    } catch (error: any) {
        console.error('Cashback offers error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
