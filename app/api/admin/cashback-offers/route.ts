import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const clientId = searchParams.get('clientId');

        let query = db
            .selectFrom('cashbackOffers')
            .leftJoin('clients', 'clients.id', 'cashbackOffers.clientId')
            .selectAll('cashbackOffers')
            .select(['clients.userId as clientUserId'])
            .orderBy('cashbackOffers.createdAt', 'desc');

        if (clientId) {
            query = query.where('cashbackOffers.clientId', '=', clientId);
        }

        const offers = await query.execute();

        return NextResponse.json({
            success: true,
            data: offers,
        });
    } catch (error: unknown) {
        console.error('Admin list cashback offers error:', error);
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : 'Server error',
            },
            { status: 500 }
        );
    }
}
