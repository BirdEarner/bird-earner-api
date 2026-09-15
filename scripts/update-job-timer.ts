import 'dotenv/config';
import { db } from '../lib/db';

async function updateJobTimer() {
    console.log('Searching for job "block 3"...');
    
    const jobs = await db
        .selectFrom('jobs')
        .select(['id', 'jobTitle', 'jobStatus', 'workDeadline', 'createdAt', 'updatedAt'])
        .where((eb) =>
            eb.or([
                eb('jobTitle', 'ilike', '%block 3%'),
                eb('jobTitle', 'ilike', '%block%'),
            ])
        )
        .orderBy('updatedAt', 'desc')
        .execute();

    console.log(`Found ${jobs.length} jobs:`);
    for (const j of jobs) {
        console.log(`- ID: ${j.id} | Title: "${j.jobTitle}" | Status: ${j.jobStatus} | Deadline: ${j.workDeadline}`);
    }

    // Find the specific "block 3" job or the most recent matching job
    const targetJob = jobs.find(j => j.jobTitle.toLowerCase().includes('block 3')) || jobs[0];

    if (!targetJob) {
        console.log('❌ No matching job found.');
        return;
    }

    // Set deadline to 1 minute from now
    const newDeadline = new Date(Date.now() + 60 * 1000); // 1 minute from now

    await db
        .updateTable('jobs')
        .set({
            workDeadline: newDeadline,
            updatedAt: new Date(),
        })
        .where('id', '=', targetJob.id)
        .execute();

    console.log(`\n✅ Updated job "${targetJob.jobTitle}" (${targetJob.id}):`);
    console.log(`   New workDeadline: ${newDeadline.toISOString()} (1 minute from now)`);
}

updateJobTimer().catch(console.error);
