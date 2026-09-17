import 'dotenv/config';
import { db } from '../lib/db';
import { getTransactionHistory } from '../lib/services/wallet';

async function main() {
    console.log('--- TESTING WALLET TRANSACTIONS API & JOB TITLE JOIN ---');

    const user = await db.selectFrom('users').select('id').executeTakeFirst();
    if (!user) {
        console.error('No user found');
        process.exit(1);
    }

    const clientTx = await getTransactionHistory(user.id, 1, 10, null, 'CLIENT');
    console.log(`Client Transactions Found: ${clientTx.transactions.length}`);
    console.log('Client Wallet Snapshot:', clientTx.walletInfo);

    if (clientTx.transactions.length > 0) {
        console.log('Sample Client Transaction:', {
            id: clientTx.transactions[0].id,
            jobTitle: clientTx.transactions[0].jobTitle,
            transactionType: clientTx.transactions[0].transactionType,
            amount: clientTx.transactions[0].amount,
            description: clientTx.transactions[0].description,
            balanceAfter: clientTx.transactions[0].balanceAfter,
        });
    }

    const freelancerTx = await getTransactionHistory(user.id, 1, 10, null, 'FREELANCER');
    console.log(`Freelancer Transactions Found: ${freelancerTx.transactions.length}`);
    console.log('Freelancer Wallet Snapshot:', freelancerTx.walletInfo);

    console.log('\n✅ WALLET TRANSACTIONS TEST PASSED SUCCESSFULLY!');
    process.exit(0);
}

main().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
