import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

// Client scratch cards: active admin offers with per-client reveal state.
// UNREVEALED offers return only {id, serviceName, masked} — code/amount/amountType
// are omitted server-side so the discount stays hidden until the client scratches.
export async function GET() {
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

        const offers = await db
            .selectFrom('adminOffers')
            .leftJoin('services', 'services.id', 'adminOffers.serviceId')
            .selectAll('adminOffers')
            .select('services.name as serviceName')
            .where('adminOffers.isActive', '=', true)
            .orderBy('adminOffers.createdAt', 'desc')
            .execute();

        const claims = await db
            .selectFrom('adminOfferClaims')
            .select(['adminOfferId', 'revealedAt', 'cashbackOfferId'])
            .where('clientId', '=', client.id)
            .execute();
        const claimByOffer = new Map(claims.map((c) => [c.adminOfferId, c]));

        const cards = offers.map((r) => {
            const claim = claimByOffer.get(r.id);
            const revealed = !!claim?.revealedAt;
            const base: Record<string, unknown> = {
                id: r.id,
                serviceName: r.serviceName,
                masked: !revealed,
                revealed,
            };
            if (revealed && claim) {
                base.code = r.code;
                base.amount = r.amount;
                base.amountType = r.amountType;
                base.minBooking = r.minBooking;
                base.maxDiscount = r.maxDiscount;
                base.revealedAt = claim.revealedAt;
                base.cashbackOfferId = claim.cashbackOfferId;
            }
            return base;
        });

        return NextResponse.json({ success: true, data: { cards } });
    } catch (error: unknown) {
        console.error('Offer cards error:', error);
        return NextResponse.json(
            { success: false, message: error instanceof Error ? error.message : 'Server error' },
            { status: 500 }
        );
    }
}
