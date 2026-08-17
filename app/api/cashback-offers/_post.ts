import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { z } from 'zod';
import { validateBody } from '@/lib/validation';

const discoverEggSchema = z.object({
    offerId: z.string().uuid({ message: 'Invalid offer ID' }),
});

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = validateBody(body, discoverEggSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { offerId } = validation.data;

        const client = await db
            .selectFrom('clients')
            .select('id')
            .where('userId', '=', user.id)
            .executeTakeFirst();

        if (!client) {
            return NextResponse.json({ message: 'Client not found' }, { status: 404 });
        }

        const saved = await db
            .updateTable('cashbackOffers')
            .set({
                discovered: true,
                updatedAt: new Date(),
            })
            .where('id', '=', offerId)
            .where('clientId', '=', client.id)
            .where('discovered', '=', false)
            .returningAll()
            .executeTakeFirst();

        if (!saved) {
            return NextResponse.json({ message: 'Offer not valid or already claimed.' }, { status: 400 });
        }

        return NextResponse.json({
            data: {
                success: true,
                message: 'Offer discovered successfully!',
                offer: saved,
            },
        });
    } catch (error: any) {
        console.error('Discover egg error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
