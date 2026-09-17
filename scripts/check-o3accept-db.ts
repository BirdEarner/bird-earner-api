import 'dotenv/config';
import { db } from '../lib/db';

async function checkJobRecords() {
    console.log('=====================================================');
    console.log('🔍 CHECKING DB RECORDS FOR JOB "O3accept"');
    console.log('=====================================================');

    // 1. Fetch Job
    const job = await db
        .selectFrom('jobs')
        .where('jobTitle', 'like', '%O3accept%')
        .select([
            'id',
            'jobTitle',
            'jobStatus',
            'paymentStatus',
            'paymentMethod',
            'budgetAmount',
            'isAmountReserved',
            'clientId',
            'assignedFreelancerId',
            'createdAt',
            'updatedAt',
        ])
        .executeTakeFirst();

    if (!job) {
        console.log('Job O3accept not found');
        return;
    }

    // 2. Fetch Client
    const client = await db
        .selectFrom('clients')
        .innerJoin('users', 'users.id', 'clients.userId')
        .where('clients.id', '=', job.clientId)
        .select([
            'clients.id as clientId',
            'clients.userId',
            'clients.wallet',
            'clients.reservedAmount',
            'clients.availableBalance',
            'users.email',
            'users.fullName'
        ])
        .executeTakeFirst();

    // 3. Fetch Freelancer
    const freelancer = job.assignedFreelancerId
        ? await db
              .selectFrom('freelancers')
              .innerJoin('users', 'users.id', 'freelancers.userId')
              .where('freelancers.id', '=', job.assignedFreelancerId)
              .select([
                  'freelancers.id as freelancerId',
                  'freelancers.userId',
                  'freelancers.withdrawableAmount',
                  'freelancers.totalEarnings',
                  'users.email',
                  'users.fullName'
              ])
              .executeTakeFirst()
        : null;

    console.log('\n--- JOB RECORD ---');
    console.log(job);

    console.log('\n--- CLIENT WALLET RECORD ---');
    console.log(client);

    console.log('\n--- FREELANCER WALLET RECORD ---');
    console.log(freelancer);

    // 4. Fetch Wallet Transactions for Job
    const txs = await db
        .selectFrom('walletTransactions')
        .where('jobId', '=', job.id)
        .selectAll()
        .execute();

    console.log('\n--- WALLET TRANSACTIONS FOR THIS JOB ---');
    console.table(txs);
}

checkJobRecords().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
