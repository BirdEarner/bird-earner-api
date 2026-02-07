import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: Request) {
    try {
        const userId = await getUserIdFromRequest(request);
        if (!userId) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { amount, description, referenceId } = await request.json();

        if (!amount || parseFloat(amount) <= 0) {
            return NextResponse.json({
                success: false,
                message: 'Invalid amount. Amount must be greater than 0'
            }, { status: 400 });
        }

        // Get client wallet
        const client = await db
            .selectFrom('clients')
            .select(['id', 'wallet'])
            .where('userId', '=', userId)
            .executeTakeFirst();

        if (!client) {
            return NextResponse.json({ success: false, message: 'Client not found' }, { status: 404 });
        }

        const currentBalance = Number(client.wallet) || 0;
        const depositAmount = Number(amount);
        const newBalance = currentBalance + depositAmount;

        // Update wallet and create transaction
        await db.transaction().execute(async (trx) => {
            await trx
                .updateTable('clients')
                .set({ wallet: String(newBalance), updatedAt: new Date() })
                .where('id', '=', client.id)
                .execute();

            await trx
                .insertInto('walletTransactions')
                .values({
                    id: uuidv4(),
                    userId,
                    userType: 'CLIENT', // Added missing field
                    amount: String(depositAmount),
                    transactionType: 'DEPOSIT',
                    description: description || 'Wallet deposit',
                    referenceId: referenceId || `DEP-${Date.now()}`,
                    balanceBefore: String(currentBalance),
                    balanceAfter: String(newBalance),
                    createdAt: new Date(),
                    updatedAt: new Date()
                })
                .execute();
        });

        return NextResponse.json({
            success: true,
            message: 'Money added to wallet successfully',
            data: {
                previousBalance: currentBalance,
                depositAmount,
                newBalance
            }
        });

    } catch (error: any) {
        console.error('Wallet deposit error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
