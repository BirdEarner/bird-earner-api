import 'dotenv/config';
import { db } from '../lib/db';

async function checkDuplicates() {
    console.log('=====================================================');
    console.log('🔍 CHECKING FOR DUPLICATE AUTO-CANCEL MESSAGES & PENALTIES');
    console.log('=====================================================');

    const duplicateMessages = await db
        .selectFrom('messages')
        .select(['chatThreadId', 'messageContent', db.fn.count<string>('id').as('count')])
        .where('messageType', '=', 'notification')
        .where('messageContent', 'like', '%BOOKING AUTO-CANCELLED%')
        .groupBy(['chatThreadId', 'messageContent'])
        .having(db.fn.count('id'), '>', '1')
        .execute();

    console.log('Duplicate Auto-Cancel Chat Messages Found:', duplicateMessages);

    const duplicatePenalties = await db
        .selectFrom('penaltyLogs')
        .select(['jobId', 'freelancerId', 'penaltyType', db.fn.count<string>('id').as('count')])
        .where('penaltyType', '=', 'FREELANCER_NON_COMPLETION')
        .groupBy(['jobId', 'freelancerId', 'penaltyType'])
        .having(db.fn.count('id'), '>', '1')
        .execute();

    console.log('Duplicate Penalty Logs Found:', duplicatePenalties);
}

checkDuplicates().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
