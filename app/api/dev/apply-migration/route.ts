import { NextResponse } from 'next/server';
import { sql } from 'kysely';
import { db } from '@/lib/db';

export async function GET() {
    try {
        await sql`ALTER TABLE "cashbackOffers" ADD COLUMN IF NOT EXISTS "minBooking" DOUBLE PRECISION NOT NULL DEFAULT 0`.execute(db);
        await sql`ALTER TABLE "cashbackOffers" ADD COLUMN IF NOT EXISTS "maxDiscount" DOUBLE PRECISION`.execute(db);

        await sql`UPDATE "cashbackOffers" SET "minBooking" = 0, "maxDiscount" = NULL WHERE "minBooking" IS NULL`.execute(db);

        return NextResponse.json({ success: true, message: 'Migration applied. Columns minBooking and maxDiscount added.' });
    } catch (error: any) {
        return NextResponse.json({ success: false, message: error.message }, { status: 500 });
    }
}
