import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { z } from 'zod';

const claimSchema = z.object({ offerId: z.string().uuid() });

// Scratch reveal: creates the per-client claim AND the underlying cashbackOffers
// coupon in one transaction, so the revealed offer flows into the EXISTING coupon
// system (apply/remove/reservedJobId/used) with zero changes to that engine.
// Un-scratched offers have no cashbackOffers row -> invisible to every coupon query.
export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const client = await db
            .selectFrom('clients')
            .select('id')
            .where('userId', '=', user.id)
            .executeTakeFirst();
        if (!client) {
            return NextResponse.json({ message: 'Client not found' }, { status: 404 });
        }

        const body = await request.json();
        const parsed = claimSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json({ success: false, message: 'Invalid payload' }, { status: 400 });
        }

        const offer = await db
            .selectFrom('adminOffers')
            .leftJoin('services', 'services.id', 'adminOffers.serviceId')
            .selectAll('adminOffers')
            .select('services.name as serviceName')
            .where('adminOffers.id', '=', parsed.data.offerId)
            .where('adminOffers.isActive', '=', true)
            .executeTakeFirst();
        if (!offer) {
            return NextResponse.json({ success: false, message: 'Offer not found' }, { status: 404 });
        }

        // Already scratched? Idempotent success (unique adminOfferId+clientId enforces once)
        const existing = await db
            .selectFrom('adminOfferClaims')
            .select(['id', 'cashbackOfferId'])
            .where('adminOfferId', '=', offer.id)
            .where('clientId', '=', client.id)
            .executeTakeFirst();
        if (existing) {
            return NextResponse.json({
                success: true,
                message: 'Already revealed',
                data: {
                    code: offer.code,
                    amount: offer.amount,
                    amountType: offer.amountType,
                    minBooking: offer.minBooking,
                    maxDiscount: offer.maxDiscount,
                    serviceId: offer.serviceId,
                    serviceName: offer.serviceName,
                    cashbackOfferId: existing.cashbackOfferId,
                },
            });
        }

        const now = new Date();
        const cashbackOfferId = crypto.randomUUID();
        const claimId = crypto.randomUUID();

        try {
            await db.transaction().execute(async (trx) => {
                await trx
                    .insertInto('cashbackOffers')
                    .values({
                        id: cashbackOfferId,
                        clientId: client.id,
                        amount: offer.amount,
                        amountType: offer.amountType,
                        minBooking: offer.minBooking,
                        maxDiscount: offer.maxDiscount,
                        discovered: true,
                        used: false,
                        serviceId: offer.serviceId,
                        code: offer.code,
                        updatedAt: now,
                    })
                    .execute();
                await trx
                    .insertInto('adminOfferClaims')
                    .values({
                        id: claimId,
                        adminOfferId: offer.id,
                        clientId: client.id,
                        revealedAt: now,
                        cashbackOfferId,
                        updatedAt: now,
                    })
                    .execute();
            });
        } catch (e: unknown) {
            // Unique violation = concurrent scratch by same client -> treat as already revealed
            const errCode = e && typeof e === 'object' && 'code' in e ? String((e as { code?: unknown }).code) : '';
            const errMsg = e instanceof Error ? e.message : '';
            if (errCode.includes('23505') || errMsg.includes('23505')) {
                const raced = await db
                    .selectFrom('adminOfferClaims')
                    .select('cashbackOfferId')
                    .where('adminOfferId', '=', offer.id)
                    .where('clientId', '=', client.id)
                    .executeTakeFirst();
                return NextResponse.json({
                    success: true,
                    message: 'Already revealed',
                    data: {
                        code: offer.code,
                        amount: offer.amount,
                        amountType: offer.amountType,
                        minBooking: offer.minBooking,
                        maxDiscount: offer.maxDiscount,
                        serviceId: offer.serviceId,
                        serviceName: offer.serviceName,
                        cashbackOfferId: raced?.cashbackOfferId || cashbackOfferId,
                    },
                });
            }
            throw e;
        }

        return NextResponse.json({
            success: true,
            message: 'Offer revealed',
            data: {
                code: offer.code,
                amount: offer.amount,
                amountType: offer.amountType,
                minBooking: offer.minBooking,
                maxDiscount: offer.maxDiscount,
                serviceId: offer.serviceId,
                serviceName: offer.serviceName,
                cashbackOfferId,
            },
        });
    } catch (error: unknown) {
        console.error('Claim offer card error:', error);
        return NextResponse.json(
            { success: false, message: error instanceof Error ? error.message : 'Server error' },
            { status: 500 }
        );
    }
}
