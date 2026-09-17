import 'dotenv/config';
import { db } from '../lib/db';

async function main() {
    const titleQuery = '%O3accept%';

    const job = await db
        .selectFrom('jobs')
        .select(['id', 'jobTitle', 'jobStatus', 'workDeadline'])
        .where('jobTitle', 'ilike', titleQuery)
        .executeTakeFirst();

    if (!job) {
        console.error(`No job found matching title: ${titleQuery}`);
        process.exit(1);
    }

    console.log(`Found Job ID: ${job.id}`);
    console.log(`Title: ${job.jobTitle}`);
    console.log(`Status: ${job.jobStatus}`);
    console.log(`Current workDeadline: ${job.workDeadline}`);

    // Set workDeadline to 1 minute from now
    const newDeadline = new Date(Date.now() + 60 * 1000);

    await db
        .updateTable('jobs')
        .set({
            workDeadline: newDeadline,
            updatedAt: new Date()
        })
        .where('id', '=', job.id)
        .execute();

    console.log(`Successfully updated workDeadline to 1 minute from now: ${newDeadline.toISOString()}`);
    process.exit(0);
}

main().catch(err => {
    console.error('Error updating job deadline:', err);
    process.exit(1);
});
