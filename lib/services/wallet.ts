import { db } from '../db';
import { TransactionType } from '../../types/types';
import { Kysely, Transaction } from 'kysely';
import { DB } from '../../types/types';

/**
 * Get client wallet information
 */
export async function getClientWallet(userId: string) {
    const client = await db
        .selectFrom('clients')
        .innerJoin('users', 'users.id', 'clients.userId')
        .select([
            'clients.id as clientId',
            'clients.userId',
            'clients.wallet',
            'clients.reservedAmount',
            'users.fullName',
            'users.email'
        ])
        .where('clients.userId', '=', userId)
        .executeTakeFirst();

    if (!client) {
        throw new Error('Client not found');
    }

    const totalBalance = parseFloat(client.wallet);
    const reservedAmount = parseFloat(client.reservedAmount);
    const availableBalance = Math.max(0, totalBalance - reservedAmount);

    return {
        ...client,
        totalBalance,
        reservedAmount,
        availableBalance
    };
}

/**
 * Validate if client has sufficient balance
 */
export async function validateClientBalance(userId: string, requiredAmount: number) {
    const wallet = await getClientWallet(userId);

    return {
        hasSufficientBalance: wallet.availableBalance >= requiredAmount,
        availableBalance: wallet.availableBalance,
        requiredAmount,
        shortfall: Math.max(0, requiredAmount - wallet.availableBalance)
    };
}

/**
 * Internal function to reserve amount for job within a transaction
 */
export async function reserveAmountForJobInTransaction(
    trx: Transaction<DB>,
    userId: string,
    jobId: string,
    amount: number
) {
    const client = await trx
        .selectFrom('clients')
        .select(['id', 'wallet', 'reservedAmount'])
        .where('userId', '=', userId)
        .executeTakeFirst();

    if (!client) {
        throw new Error('Client not found');
    }

    const currentWallet = parseFloat(client.wallet);
    const currentReserved = parseFloat(client.reservedAmount);
    const availableBalance = currentWallet - currentReserved;

    if (availableBalance < amount) {
        throw new Error(`Insufficient balance. Available: ${availableBalance}, Required: ${amount}`);
    }

    const newReserved = currentReserved + amount;

    // Update client reserved amount
    await trx
        .updateTable('clients')
        .set({
            reservedAmount: newReserved.toString(),
            updatedAt: new Date()
        })
        .where('id', '=', client.id)
        .execute();

    // Create wallet transaction record
    const transaction = await trx
        .insertInto('walletTransactions')
        .values({
            id: crypto.randomUUID(),
            userId,
            userType: 'CLIENT',
            jobId,
            transactionType: 'JOB_RESERVE',
            amount: amount.toString(),
            balanceBefore: currentWallet.toString(),
            balanceAfter: currentWallet.toString(),
            description: 'Amount reserved for job',
            updatedAt: new Date()
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    return {
        success: true,
        reservedAmount: amount,
        newAvailableBalance: availableBalance - amount,
        transactionId: transaction.id
    };
}

/**
 * Internal function to release reserved amount within a transaction
 */
export async function releaseReservedAmountInTransaction(
    trx: Transaction<DB>,
    userId: string,
    jobId: string
) {
    const job = await trx
        .selectFrom('jobs')
        .select(['budgetAmount', 'isAmountReserved'])
        .where('id', '=', jobId)
        .executeTakeFirst();

    if (!job || !job.isAmountReserved) {
        throw new Error('Job not found or amount not reserved');
    }

    const client = await trx
        .selectFrom('clients')
        .select(['id', 'wallet', 'reservedAmount'])
        .where('userId', '=', userId)
        .executeTakeFirst();

    if (!client) {
        throw new Error('Client not found');
    }

    const releaseAmount = parseFloat(job.budgetAmount);
    const currentWallet = parseFloat(client.wallet);
    const currentReserved = parseFloat(client.reservedAmount);
    const newReserved = Math.max(0, currentReserved - releaseAmount);

    // Update client reserved amount
    await trx
        .updateTable('clients')
        .set({
            reservedAmount: newReserved.toString(),
            updatedAt: new Date()
        })
        .where('id', '=', client.id)
        .execute();

    // Create wallet transaction record
    const transaction = await trx
        .insertInto('walletTransactions')
        .values({
            id: crypto.randomUUID(),
            userId,
            userType: 'CLIENT',
            jobId,
            transactionType: 'JOB_RELEASE',
            amount: releaseAmount.toString(),
            balanceBefore: currentWallet.toString(),
            balanceAfter: currentWallet.toString(),
            description: 'Released reserved amount for cancelled job',
            updatedAt: new Date()
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    return {
        success: true,
        releasedAmount: releaseAmount,
        newAvailableBalance: currentWallet - newReserved,
        transactionId: transaction.id
    };
}

/**
 * Internal function to process job payment within a transaction
 */
export async function processJobPaymentInTransaction(
    trx: Transaction<DB>,
    jobId: string
) {
    const job = await trx
        .selectFrom('jobs')
        .innerJoin('clients', 'clients.id', 'jobs.clientId')
        .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
        .select([
            'jobs.id',
            'jobs.jobTitle',
            'jobs.budgetAmount',
            'jobs.birdFeeAmount',
            'jobs.paymentStatus',
            'jobs.isAmountReserved',
            'clients.id as clientId',
            'clients.userId as clientUserId',
            'clients.wallet as clientWallet',
            'clients.reservedAmount as clientReserved',
            'freelancers.id as freelancerId',
            'freelancers.userId as freelancerUserId',
            'freelancers.totalEarnings as freelancerTotalEarnings',
            'freelancers.monthlyEarnings as freelancerMonthlyEarnings',
            'freelancers.withdrawableAmount as freelancerWithdrawable'
        ])
        .where('jobs.id', '=', jobId)
        .executeTakeFirst();

    if (!job) {
        throw new Error('Job not found');
    }

    if (!job.freelancerId) {
        throw new Error('No freelancer assigned to this job');
    }

    if (job.paymentStatus === 'COMPLETED') {
        throw new Error('Payment already completed for this job');
    }

    if (!job.isAmountReserved) {
        throw new Error('Amount not reserved for this job');
    }

    const budgetAmount = parseFloat(job.budgetAmount);
    const birdFeeAmount = parseFloat(job.birdFeeAmount || '0');
    const freelancerPaymentAmount = budgetAmount - birdFeeAmount;

    const clientCurrentWallet = parseFloat(job.clientWallet);
    const clientCurrentReserved = parseFloat(job.clientReserved);

    const freelancerCurrentEarnings = parseFloat(job.freelancerTotalEarnings!);
    const freelancerCurrentMonthly = parseFloat(job.freelancerMonthlyEarnings!);
    const freelancerCurrentWithdrawable = parseFloat(job.freelancerWithdrawable!);

    // 1. Deduct full budget amount from client wallet and reserved amount
    await trx
        .updateTable('clients')
        .set({
            wallet: (clientCurrentWallet - budgetAmount).toString(),
            reservedAmount: Math.max(0, clientCurrentReserved - budgetAmount).toString(),
            updatedAt: new Date()
        })
        .where('id', '=', job.clientId)
        .execute();

    // 2. Add freelancer payment amount to freelancer earnings
    await trx
        .updateTable('freelancers')
        .set({
            totalEarnings: (freelancerCurrentEarnings + freelancerPaymentAmount).toString(),
            monthlyEarnings: (freelancerCurrentMonthly + freelancerPaymentAmount).toString(),
            withdrawableAmount: (freelancerCurrentWithdrawable + freelancerPaymentAmount).toString(),
            updatedAt: new Date()
        })
        .where('id', '=', job.freelancerId)
        .execute();

    // 3. Create wallet transaction for client (debit full budget amount)
    const clientTransaction = await trx
        .insertInto('walletTransactions')
        .values({
            id: crypto.randomUUID(),
            userId: job.clientUserId,
            userType: 'CLIENT',
            jobId,
            transactionType: 'JOB_PAYMENT',
            amount: (-budgetAmount).toString(),
            balanceBefore: clientCurrentWallet.toString(),
            balanceAfter: (clientCurrentWallet - budgetAmount).toString(),
            description: `Payment for job: ${job.jobTitle}`,
            updatedAt: new Date()
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    // 4. Create wallet transaction for freelancer (credit payment)
    const freelancerTransaction = await trx
        .insertInto('walletTransactions')
        .values({
            id: crypto.randomUUID(),
            userId: job.freelancerUserId!,
            userType: 'FREELANCER',
            jobId,
            transactionType: 'JOB_PAYMENT',
            amount: freelancerPaymentAmount.toString(),
            balanceBefore: freelancerCurrentWithdrawable.toString(),
            balanceAfter: (freelancerCurrentWithdrawable + freelancerPaymentAmount).toString(),
            description: `Earnings from job: ${job.jobTitle} (after platform fee)`,
            updatedAt: new Date()
        })
        .returningAll()
        .executeTakeFirstOrThrow();

    // 5. Create platform fee transaction if any
    if (birdFeeAmount > 0) {
        await trx
            .insertInto('walletTransactions')
            .values({
                id: crypto.randomUUID(),
                userId: job.freelancerUserId!,
                userType: 'FREELANCER',
                jobId,
                transactionType: 'PLATFORM_FEE',
                amount: (-birdFeeAmount).toString(),
                balanceBefore: (freelancerCurrentWithdrawable + freelancerPaymentAmount).toString(),
                balanceAfter: (freelancerCurrentWithdrawable + freelancerPaymentAmount).toString(),
                description: `Platform fee for job: ${job.jobTitle}`,
                updatedAt: new Date()
            })
            .execute();
    }

    return {
        success: true,
        budgetAmount,
        freelancerPaymentAmount,
        birdFeeAmount,
        clientTransactionId: clientTransaction.id,
        freelancerTransactionId: freelancerTransaction.id
    };
}

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

/**
 * Update reserved amount for budget change
 */
export async function updateReservedAmountForBudgetChange(
    userId: string,
    jobId: string,
    oldBudget: number,
    newBudget: number
) {
    const budgetDifference = newBudget - oldBudget;

    if (budgetDifference === 0) {
        return { success: true, message: 'No budget change required', budgetDifference: 0 };
    }

    return await db.transaction().execute(async (trx) => {
        const client = await trx
            .selectFrom('clients')
            .select(['id', 'wallet', 'reservedAmount'])
            .where('userId', '=', userId)
            .executeTakeFirst();

        if (!client) throw new Error('Client not found');

        const currentWallet = parseFloat(client.wallet);
        const currentReserved = parseFloat(client.reservedAmount);
        const availableBalance = currentWallet - currentReserved;

        if (budgetDifference > 0 && availableBalance < budgetDifference) {
            throw new Error(`Insufficient balance for budget increase. Available: ${availableBalance}, Required: ${budgetDifference}`);
        }

        const actualNewReserved = Math.max(0, currentReserved + budgetDifference);

        await trx
            .updateTable('clients')
            .set({
                reservedAmount: actualNewReserved.toString(),
                updatedAt: new Date()
            })
            .where('id', '=', client.id)
            .execute();

        const trType = budgetDifference > 0 ? 'JOB_RESERVE' : 'JOB_RELEASE';
        const strAmount = Math.abs(budgetDifference).toString();

        const transaction = await trx
            .insertInto('walletTransactions')
            .values({
                id: crypto.randomUUID(),
                userId,
                userType: 'CLIENT',
                jobId,
                transactionType: trType,
                amount: strAmount,
                balanceBefore: currentWallet.toString(),
                balanceAfter: currentWallet.toString(),
                description: budgetDifference > 0
                    ? `Additional amount reserved for job budget increase`
                    : `Amount released from job budget decrease`,
                updatedAt: new Date()
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        return {
            success: true,
            budgetDifference,
            newReservedAmount: actualNewReserved,
            transactionId: transaction.id
        };
    });
}
