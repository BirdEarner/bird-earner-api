import 'dotenv/config';
import { db } from '../lib/db';
import { getTransactionHistory } from '../lib/services/wallet';

async function main() {
    console.log('--- TESTING WALLET TRANSACTIONS POINT-IN-TIME SNAPSHOTS ---');

    // Find a client user with wallet transactions
    const clientUser = await db
        .selectFrom('clients')
        .select('userId')
        .executeTakeFirst();

    if (!clientUser) {
        console.error('No client user found');
        process.exit(1);
    }

    const clientTx = await getTransactionHistory(clientUser.userId, 1, 10, null, 'CLIENT');
    console.log(`Client Transactions Found: ${clientTx.transactions.length}`);
    console.log('Current Client Wallet State:', clientTx.walletInfo);

    if (clientTx.transactions.length > 0) {
        console.log('\n--- Point-in-Time Snapshot Card Details ---');
        clientTx.transactions.forEach((tx: any, idx: number) => {
            console.log(`Card ${idx + 1} (${tx.transactionType} - Amount: ₹${tx.amount}):`);
            console.log(`  Previous Wallet Balance: ₹${tx.balanceBefore}`);
            console.log(`  Current Wallet Balance:  ₹${tx.balanceAfter}`);
            console.log(`  Current Reserve Value:   ₹${tx.currentReserveValue}`);
            console.log(`  Total Reserved Value:    ₹${tx.reservedAfter}`);
            console.log(`  Current Available Bal:   ₹${tx.availableAfter}`);
            console.log('-------------------------------------------');
        });
    }

    console.log('\n✅ POINT-IN-TIME SNAPSHOT TEST COMPLETED SUCCESSFULLY!');
    process.exit(0);
}

main().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
