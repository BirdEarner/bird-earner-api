const { Pool } = require('pg');

const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_5LhU2ejwQWTf@ep-polished-scene-a1dk2u3u-pooler.ap-southeast-1.aws.neon.tech/birdearner?sslmode=require',
    ssl: { rejectUnauthorized: false }
});

async function seedTestJobs() {
    const client = await pool.connect();
    try {
        // 1. Find client by email
        const userResult = await client.query(
            "SELECT id FROM users WHERE email = $1",
            ['dhanshreeshinde2003@gmail.com']
        );

        if (userResult.rows.length === 0) {
            console.log('User not found with email: dhanshreeshinde2003@gmail.com');
            return;
        }

        const userId = userResult.rows[0].id;
        console.log('Found user ID:', userId);

        // 2. Find client profile
        const clientResult = await client.query(
            "SELECT id FROM clients WHERE \"userId\" = $1",
            [userId]
        );

        if (clientResult.rows.length === 0) {
            console.log('Client profile not found for this user');
            return;
        }

        const clientId = clientResult.rows[0].id;
        console.log('Found client ID:', clientId);

        // 3. Check existing completed jobs this month
        const existingJobs = await client.query(
            `SELECT id FROM jobs 
             WHERE "clientId" = $1 
             AND "jobStatus" = 'COMPLETED' 
             AND "completedAt" >= DATE_TRUNC('month', NOW())
             AND "completedAt" <= NOW()`,
            [clientId]
        );
        console.log('Existing completed jobs this month:', existingJobs.rows.length);

        // 4. Create 3 completed jobs
        const now = new Date();
        const jobs = [];

        for (let i = 1; i <= 3; i++) {
            const jobId = crypto.randomUUID();
            const completedAt = new Date(now);
            completedAt.setDate(now.getDate() - i); // Stagger dates

            const result = await client.query(
                `INSERT INTO jobs (
                    id, "jobTitle", "jobDescription", "jobCategory", "jobSubCategory",
                    "projectType", "budgetType", "budgetAmount", "clientId",
                    "jobStatus", "completedAt", "createdAt", "updatedAt",
                    "paymentMethod", "proposalCount"
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
                RETURNING id, "jobTitle", "jobStatus", "completedAt"`,
                [
                    jobId,
                    `Test Job ${i}`,
                    `This is test job ${i} for testing cashback offers`,
                    'Web Development',
                    'Frontend',
                    'FIXED',
                    'FIXED',
                    '5000',
                    clientId,
                    'COMPLETED',
                    completedAt,
                    completedAt,
                    now,
                    'ONLINE',
                    0
                ]
            );

            jobs.push(result.rows[0]);
            console.log(`Created job ${i}:`, result.rows[0]);
        }

        console.log('\n=== SUMMARY ===');
        console.log('Client ID:', clientId);
        console.log('Jobs created:', jobs.length);
        jobs.forEach(j => console.log(`  - ${j.jobTitle} (${j.jobStatus}) completed at ${j.completedAt}`));
        console.log('\nNow the client should see 3 eggs on the Offers screen!');

    } catch (error) {
        console.error('Error:', error.message);
    } finally {
        client.release();
        await pool.end();
    }
}

seedTestJobs();
