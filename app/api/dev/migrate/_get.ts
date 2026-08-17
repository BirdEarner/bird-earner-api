import { db } from '@/lib/db';
import { sql } from 'kysely';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        await sql`
            ALTER TABLE "chatThreads" 
            ADD COLUMN IF NOT EXISTS "clientOffer" DECIMAL(10,2),
            ADD COLUMN IF NOT EXISTS "freelancerOffer" DECIMAL(10,2),
            ADD COLUMN IF NOT EXISTS "agreedAmount" DECIMAL(10,2);
        `.execute(db);

        await sql`ALTER TABLE "cashbackOffers" ADD COLUMN IF NOT EXISTS "minBooking" DOUBLE PRECISION NOT NULL DEFAULT 0`.execute(db);
        await sql`ALTER TABLE "cashbackOffers" ADD COLUMN IF NOT EXISTS "maxDiscount" DOUBLE PRECISION`.execute(db);

        return NextResponse.json({ success: true, message: 'Migration executed successfully' });
    } catch (error: any) {
        console.error('Auto-migration error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
