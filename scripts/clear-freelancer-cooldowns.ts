import 'dotenv/config';
import { db } from '../lib/db';

async function clearFreelancerCooldowns() {
    console.log('Clearing freelancer cooldowns and penalty locks...');
    await db
        .updateTable('freelancers')
        .set({
            cooldownExpiresAt: null,
            withdrawableAmount: '0.00',
        })
        .execute();
    console.log('✅ All freelancer cooldowns and negative penalty balances cleared.');
}

clearFreelancerCooldowns()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
