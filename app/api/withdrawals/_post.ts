import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const withdrawalSchema = z.object({
    amount: z.number().positive(),
    bankDetails: z.any().optional(),
});

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), withdrawalSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { amount, bankDetails } = validation.data;

        const result = await db.transaction().execute(async (trx) => {
            const freelancer = await trx
                .selectFrom('freelancers')
                .selectAll()
                .where('userId', '=', user.id)
                .executeTakeFirst();

            if (!freelancer) throw new Error('Freelancer profile not found');

            const withdrawableBalance = parseFloat(freelancer.withdrawableAmount);
            if (withdrawableBalance < amount) {
                throw new Error(`Insufficient balance. Available: ${withdrawableBalance}, Requested: ${amount}`);
            }

            const withdrawalRequest = await trx
                .insertInto('withdrawalRequests')
                .values({
                    id: crypto.randomUUID(),
                    freelancerId: freelancer.id,
                    amount: amount.toString(),
                    bankDetails: bankDetails ? JSON.stringify(bankDetails) : null,
                    status: 'PENDING',
                    updatedAt: new Date()
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            const newBalance = withdrawableBalance - amount;
            await trx
                .updateTable('freelancers')
                .set({ withdrawableAmount: newBalance.toString(), updatedAt: new Date() })
                .where('id', '=', freelancer.id)
                .execute();

            return {
                withdrawalRequest,
                remainingBalance: newBalance
            };
        });

        return NextResponse.json({
            success: true,
            message: 'Withdrawal request submitted successfully',
            data: result
        });
    } catch (error: any) {
        console.error('Create withdrawal error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
