import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { z } from 'zod';
import { validateBody } from '@/lib/validation';

const removeCouponSchema = z.object({
    jobId: z.string().uuid(),
});

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = validateBody(body, removeCouponSchema);
        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { jobId } = validation.data;

        const client = await db
            .selectFrom('clients')
            .select('id')
            .where('userId', '=', user.id)
            .executeTakeFirst();

        if (!client) {
            return NextResponse.json({ message: 'Client not found' }, { status: 404 });
        }

        const job = await db
            .selectFrom('jobs')
            .select(['id', 'clientId', 'cashbackOfferId'])
            .where('id', '=', jobId)
            .where('deleted', '=', false)
            .executeTakeFirst();

        if (!job || job.clientId !== client.id) {
            return NextResponse.json({ message: 'Job not found' }, { status: 404 });
        }

        if (!job.cashbackOfferId) {
            return NextResponse.json({ message: 'No coupon applied to this job.' }, { status: 400 });
        }

        await db.transaction().execute(async (trx) => {
            await trx
                .updateTable('cashbackOffers')
                .set({ reservedJobId: null, updatedAt: new Date() })
                .where('id', '=', job.cashbackOfferId!)
                .execute();

            await trx
                .updateTable('jobs')
                .set({
                    cashbackOfferId: null,
                    discountAmount: '0',
                    updatedAt: new Date(),
                })
                .where('id', '=', jobId)
                .execute();
        });

        return NextResponse.json({
            success: true,
            message: 'Coupon removed successfully!',
        });
    } catch (error: any) {
        console.error('Remove coupon error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
