import 'dotenv/config';
import { db } from '../lib/db';

async function main() {
    const email = 'dhanshreeshinde276@gmail.com';

    const user = await db
        .selectFrom('users')
        .select(['id', 'email'])
        .where('email', '=', email)
        .executeTakeFirst();

    if (!user) {
        console.error(`User not found for email: ${email}`);
        process.exit(1);
    }

    const freelancer = await db
        .selectFrom('freelancers')
        .select(['id', 'cooldownExpiresAt', 'cancellationStrikes'])
        .where('userId', '=', user.id)
        .executeTakeFirst();

    if (!freelancer) {
        console.error(`Freelancer profile not found for user: ${user.id}`);
        process.exit(1);
    }

    console.log(`Found Freelancer ID: ${freelancer.id}`);
    console.log(`Current Cooldown Expiry: ${freelancer.cooldownExpiresAt}`);

    await db
        .updateTable('freelancers')
        .set({
            cooldownExpiresAt: null,
            updatedAt: new Date()
        })
        .where('id', '=', freelancer.id)
        .execute();

    console.log(`Successfully cleared cooldown for user ${email}`);
    process.exit(0);
}

main().catch(err => {
    console.error('Error clearing cooldown:', err);
    process.exit(1);
});
