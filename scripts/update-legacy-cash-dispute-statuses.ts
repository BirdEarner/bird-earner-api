import 'dotenv/config';
import { db } from '../lib/db';

async function updateLegacyCashDisputeStatuses() {
    console.log('Updating legacy cash jobs with REFUNDED status to CANCELLED...');

    const result = await db
        .updateTable('jobs')
        .set({
            jobStatus: 'CANCELLED' as any,
            paymentStatus: 'CANCELLED' as any,
        })
        .where('paymentMethod', '=', 'CASH')
        .where('jobStatus', '=', 'REFUNDED' as any)
        .executeTakeFirst();

    console.log(`Updated ${result.numUpdatedRows} cash dispute jobs to CANCELLED.`);
}

updateLegacyCashDisputeStatuses()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
