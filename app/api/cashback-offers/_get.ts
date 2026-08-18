import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';

const offerOptions = [
    { amount: 10, amountType: 'LUMPSUM' as const, minBooking: 199, maxDiscount: null },
    { amount: 15, amountType: 'LUMPSUM' as const, minBooking: 299, maxDiscount: null },
    { amount: 20, amountType: 'LUMPSUM' as const, minBooking: 399, maxDiscount: null },
    { amount: 25, amountType: 'LUMPSUM' as const, minBooking: 499, maxDiscount: null },
    { amount: 30, amountType: 'LUMPSUM' as const, minBooking: 599, maxDiscount: null },
    { amount: 5,  amountType: 'PERCENT' as const, minBooking: 299, maxDiscount: 25 },
    { amount: 5,  amountType: 'PERCENT' as const, minBooking: 499, maxDiscount: 40 },
    { amount: 7,  amountType: 'PERCENT' as const, minBooking: 699, maxDiscount: 50 },
    { amount: 10, amountType: 'PERCENT' as const, minBooking: 999, maxDiscount: 50 },
    { amount: 3,  amountType: 'PERCENT' as const, minBooking: 299, maxDiscount: 20 },
];

function calculateEggs(jobs: any[]) {
    return jobs.length;
}

export async function GET(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const url = new URL(request.url);
        const jobId = url.searchParams.get('jobId');

        const client = await db
            .selectFrom('clients')
            .select('id')
            .where('userId', '=', user.id)
            .executeTakeFirst();

        if (!client) {
            return NextResponse.json({ message: 'Client not found' }, { status: 404 });
        }

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        startOfMonth.setHours(0, 0, 0, 0);

        const endOfToday = new Date(now);
        endOfToday.setHours(23, 59, 59, 999);

        const jobs = await db
            .selectFrom('jobs')
            .select(['id', 'completedAt', 'budgetAmount'])
            .where('clientId', '=', client.id)
            .where('deleted', '=', false)
            .where('completedAt', '>=', startOfMonth)
            .where('completedAt', '<=', endOfToday)
            .where('jobStatus', '=', 'COMPLETED')
            .execute();

        const totalJobs = jobs.length;
        const totalEggs = calculateEggs(jobs);

        const discoveredOffers = await db
            .selectFrom('cashbackOffers')
            .selectAll()
            .where('clientId', '=', client.id)
            .where('discovered', '=', true)
            .where('used', '=', false)
            .where('createdAt', '>=', startOfMonth)
            .where('createdAt', '<=', endOfToday)
            .where((eb) => eb.or([
                eb('reservedJobId', 'is', null),
                jobId ? eb('reservedJobId', '=', jobId) : eb('reservedJobId', 'is', null),
            ]))
            .execute();

        const undiscoveredOffers = await db
            .selectFrom('cashbackOffers')
            .selectAll()
            .where('clientId', '=', client.id)
            .where('discovered', '=', false)
            .where('createdAt', '>=', startOfMonth)
            .where('createdAt', '<=', endOfToday)
            .execute();

        let availableOffers = undiscoveredOffers;

        if (discoveredOffers.length + undiscoveredOffers.length < totalEggs) {
            const eggsToCreate = totalEggs - discoveredOffers.length - undiscoveredOffers.length;

            const newOffers = [];
            for (let i = 0; i < eggsToCreate; i++) {
                const random = offerOptions[Math.floor(Math.random() * offerOptions.length)];
                newOffers.push({
                    id: crypto.randomUUID(),
                    clientId: client.id,
                    amount: random.amount,
                    amountType: random.amountType,
                    minBooking: random.minBooking,
                    maxDiscount: random.maxDiscount,
                    discovered: false,
                    used: false,
                    updatedAt: new Date(),
                });
            }

            if (newOffers.length > 0) {
                await db
                    .insertInto('cashbackOffers')
                    .values(newOffers)
                    .execute();

                const freshUndiscovered = await db
                    .selectFrom('cashbackOffers')
                    .selectAll()
                    .where('clientId', '=', client.id)
                    .where('discovered', '=', false)
                    .where('createdAt', '>=', startOfMonth)
                    .where('createdAt', '<=', endOfToday)
                    .execute();

                availableOffers = freshUndiscovered;
            }
        } else if (discoveredOffers.length + undiscoveredOffers.length > totalEggs) {
            const excessCount = (discoveredOffers.length + undiscoveredOffers.length) - totalEggs;
            const excessIds = undiscoveredOffers.slice(0, excessCount).map(o => o.id);

            if (excessIds.length > 0) {
                await db
                    .deleteFrom('cashbackOffers')
                    .where('id', 'in', excessIds)
                    .execute();

                availableOffers = undiscoveredOffers.filter(o => !excessIds.includes(o.id));
            }
        }

        return NextResponse.json({
            discoveredOffers,
            availableOffers,
            totalEggs,
            totalJobs,
        });
    } catch (error: any) {
        console.error('Cashback offers error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
