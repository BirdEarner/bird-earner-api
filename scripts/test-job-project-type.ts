import 'dotenv/config';

async function testJobProjectTypeApi() {
    console.log('Testing GET /api/jobs and /api/jobs/categorized/priority projectType payloads...');

    // 1. Check /api/jobs
    const res1 = await fetch('http://localhost:3001/api/jobs');
    const json1 = await res1.json();
    console.log('--- /api/jobs ---');
    console.log('HTTP Status:', res1.status);
    if (json1.success && Array.isArray(json1.data?.jobs)) {
        json1.data.jobs.slice(0, 3).forEach((j: any, idx: number) => {
            console.log(`Job #${idx + 1}: Title="${j.jobTitle}" | projectType="${j.projectType}" | location="${j.location}"`);
        });
    }

    // 2. Check /api/jobs/categorized/priority
    const res2 = await fetch('http://localhost:3001/api/jobs/categorized/priority');
    const json2 = await res2.json();
    console.log('\n--- /api/jobs/categorized/priority ---');
    console.log('HTTP Status:', res2.status);
    if (json2.success && json2.data) {
        const allJobs = [
            ...(json2.data.Immediate || []),
            ...(json2.data.High || []),
            ...(json2.data.Standard || []),
        ];
        console.log(`Found ${allJobs.length} categorized jobs.`);
        allJobs.slice(0, 5).forEach((j: any, idx: number) => {
            console.log(`Categorized Job #${idx + 1}: Title="${j.jobTitle}" | projectType="${j.projectType}" | location="${j.location}"`);
        });

        const missing = allJobs.filter((j: any) => j.projectType === undefined);
        if (missing.length === 0) {
            console.log('\n✅ ALL TESTED ENDPOINTS RETURNED projectType SUCCESSFULLY!');
        } else {
            console.error(`\n❌ FAILED: ${missing.length} jobs missing projectType`);
        }
    }
}

testJobProjectTypeApi()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
