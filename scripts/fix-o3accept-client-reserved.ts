import 'dotenv/config';
import { db } from '../lib/db';

async function fixClientReserved() {
    console.log('Fixing client reserved amount for job O3accept...');

    const client = await db
        .selectFrom('clients')
        .innerJoin('users', 'users.id', 'clients.userId')
        .where('users.email', '=', 'dhanshreeshinde2003@gmail.com')
        .select(['clients.id', 'clients.wallet', 'clients.reservedAmount'])
        .executeTakeFirst();

    if (!client) {
        console.log('Client not found');
        return;
    }

    const currentWallet = parseFloat(client.wallet);
    // Since job O3accept (₹2.00) payment was completed and transferred to freelancer,
    // the client's total wallet should be reduced by ₹2.00 (from 29989.94 to 29987.94),
    // and reservedAmount should be reduced from 2.00 to 0.00.
    const newWallet = (currentWallet - 2.00).toString();
    const newReserved = '0.00';
    const newAvailable = (parseFloat(newWallet) - parseFloat(newReserved)).toString();

    await db
        .updateTable('clients')
        .set({
            wallet: newWallet,
            reservedAmount: newReserved,
            availableBalance: newAvailable,
            updatedAt: new Date()
        })
        .where('id', '=', client.id)
        .execute();

    console.log(`✅ Client wallet updated successfully:`);
    console.log(`- Wallet Total: ₹${client.wallet} -> ₹${newWallet}`);
    console.log(`- Reserved Amount: ₹${client.reservedAmount} -> ₹${newReserved}`);
    console.log(`- Available Balance: ₹${newAvailable}`);
}

fixClientReserved().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
