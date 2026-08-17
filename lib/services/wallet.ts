import { db } from '../db';
import { TransactionType } from '../../types/types';
import { Kysely, Transaction } from 'kysely';
import { DB } from '../../types/types';

/**
 * Get freelancer wallet information
 */
export async function getFreelancerWallet(userId: string) {
    const freelancer = await db
        .selectFrom('freelancers')
        .innerJoin('users', 'users.id', 'freelancers.userId')
        .select([
            'freelancers.id as freelancerId',
            'freelancers.userId',
            'freelancers.withdrawableAmount',
            'freelancers.totalEarnings',
            'freelancers.monthlyEarnings',
            'users.fullName',
            'users.email'
        ])
        .where('freelancers.userId', '=', userId)
        .executeTakeFirst();

    if (!freelancer) {
        throw new Error('Freelancer not found');
    }

    return {
        ...freelancer,
        withdrawableBalance: parseFloat(freelancer.withdrawableAmount),
        totalEarnings: parseFloat(freelancer.totalEarnings),
        monthlyEarnings: parseFloat(freelancer.monthlyEarnings)
    };
}

/**
 * Settle freelancer outstanding balance (deposit logic for freelancers)
 */
export async function settleFreelancerBalance(
    userId: string,
    amount: number,
    description = 'Balance settlement',
    referenceId: string | null = null
) {
    return await db.transaction().execute(async (trx) => {
        // Idempotency check: Check if transaction already exists for this payment reference
        if (referenceId) {
            const existingTx = await trx
                .selectFrom('walletTransactions')
                .select('id')
                .where('referenceId', '=', referenceId)
                .executeTakeFirst();
            
            if (existingTx) {
                return {
                    success: true,
                    message: 'Transaction already processed',
                    transactionId: existingTx.id,
                    duplicate: true
                };
            }
        }

        const freelancer = await trx
            .selectFrom('freelancers')
            .select(['id', 'withdrawableAmount'])
            .where('userId', '=', userId)
            .executeTakeFirst();

        if (!freelancer) {
            throw new Error('Freelancer not found');
        }

        const settlementAmount = amount;
        const currentWithdrawable = parseFloat(freelancer.withdrawableAmount);
        const newWithdrawable = currentWithdrawable + settlementAmount;

        // Update freelancer wallet
        await trx
            .updateTable('freelancers')
            .set({
                withdrawableAmount: newWithdrawable.toString(),
                updatedAt: new Date()
            })
            .where('id', '=', freelancer.id)
            .execute();

        // Create wallet transaction record
        const transaction = await trx
            .insertInto('walletTransactions')
            .values({
                id: crypto.randomUUID(),
                userId,
                userType: 'FREELANCER',
                transactionType: 'DEPOSIT',
                amount: settlementAmount.toString(),
                balanceBefore: currentWithdrawable.toString(),
                balanceAfter: newWithdrawable.toString(),
                description,
                referenceId,
                updatedAt: new Date()
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        return {
            success: true,
            newBalance: newWithdrawable,
            transactionId: transaction.id
        };
    });
}

/**
 * Get wallet transaction history
 */
export async function getTransactionHistory(
    userId: string,
    page = 1,
    limit = 20,
    transactionType: TransactionType | null = null,
    userType: 'CLIENT' | 'FREELANCER' | null = null
) {
    const skip = (page - 1) * limit;

    let query = db
        .selectFrom('walletTransactions')
        .where('userId', '=', userId);

    if (transactionType) {
        query = query.where('transactionType', '=', transactionType);
    }

    if (userType) {
        query = query.where('userType', '=', userType);
    }

    const [total, transactions] = await Promise.all([
        query
            .select(({ fn }) => fn.count('id').as('count'))
            .executeTakeFirst(),
        query
            .selectAll()
            .orderBy('createdAt', 'desc')
            .offset(skip)
            .limit(limit)
            .execute()
    ]);

    return {
        transactions,
        pagination: {
            total: Number(total?.count || 0),
            page,
            limit,
            totalPages: Math.ceil(Number(total?.count || 0) / limit)
        }
    };
}
