import 'dotenv/config';
import { db } from '../lib/db.js';
import crypto from 'crypto';

async function addWalletFunds() {
    const targetEmail = 'dhanshreeshinde2003@gmail.com';
    const addAmount = 10000;

    console.log(`Searching for user with email: ${targetEmail}`);

    const user = await db
        .selectFrom('users')
        .select(['id', 'email', 'fullName'])
        .where('email', '=', targetEmail)
        .executeTakeFirst();

    if (!user) {
        console.error(`❌ User not found with email: ${targetEmail}`);
        process.exit(1);
    }

    console.log(`Found user: ${user.fullName || user.email} (${user.id})`);

    let client = await db
        .selectFrom('clients')
        .select(['id', 'availableBalance', 'wallet'])
        .where('userId', '=', user.id)
        .executeTakeFirst();

    if (!client) {
        console.log(`Creating client profile for user ${user.id}...`);
        client = await db
            .insertInto('clients')
            .values({
                id: crypto.randomUUID(),
                userId: user.id,
                wallet: addAmount.toFixed(2),
                availableBalance: addAmount.toFixed(2),
                reservedAmount: '0.00',
                updatedAt: new Date(),
            })
            .returning(['id', 'availableBalance', 'wallet'])
            .executeTakeFirstOrThrow();
    } else {
        const currentBalance = parseFloat(client.availableBalance?.toString() || '0');
        const currentWallet = parseFloat(client.wallet?.toString() || '0');
        const newBalance = currentBalance + addAmount;
        const newWallet = currentWallet + addAmount;

        console.log(`Current Available Balance: ₹${currentBalance}`);
        console.log(`Adding: ₹${addAmount}`);
        console.log(`New Available Balance: ₹${newBalance}`);

        await db
            .updateTable('clients')
            .set({
                availableBalance: newBalance.toFixed(2),
                wallet: newWallet.toFixed(2),
                updatedAt: new Date(),
            })
            .where('id', '=', client.id)
            .execute();
    }

    // Insert transaction log
    await db
        .insertInto('walletTransactions')
        .values({
            id: crypto.randomUUID(),
            userId: user.id,
            userType: 'CLIENT',
            transactionType: 'DEPOSIT',
            amount: addAmount.toFixed(2),
            balanceBefore: '0.00',
            balanceAfter: addAmount.toFixed(2),
            description: 'Manual wallet credit of ₹10,000',
            createdAt: new Date(),
            updatedAt: new Date(),
        })
        .execute();

    console.log(`✅ Successfully added ₹${addAmount} to ${targetEmail}'s wallet!`);
}

addWalletFunds()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('Error adding wallet funds:', err);
        process.exit(1);
    });
