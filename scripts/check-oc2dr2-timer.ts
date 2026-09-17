import 'dotenv/config';
import { db } from '../lib/db';

async function checkJobTimers() {
    const job = await db
        .selectFrom('jobs')
        .select(['id', 'jobTitle', 'jobStatus', 'projectType', 'location', 'otpVerifiedAt', 'workDeadline', 'deadlineDate', 'freelancerGracePeriodExpiresAt'])
        .where('jobTitle', '=', 'OC2dr2')
        .executeTakeFirst();

    console.log(job);
}

checkJobTimers().then(() => process.exit(0)).catch(console.error);
