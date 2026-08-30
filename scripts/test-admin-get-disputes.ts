import 'dotenv/config';
import { generateToken } from '../lib/auth';

async function testGetDisputesApi() {
    console.log('Testing GET /api/admin/disputes API...');

    const token = generateToken({
        id: 999,
        email: 'superadmin@birdearner.com',
        role: 'superadmin',
    });

    const res = await fetch('http://localhost:3001/api/admin/disputes', {
        headers: {
            Authorization: `Bearer ${token}`,
        },
    });

    console.log('HTTP Status:', res.status);
    const data = await res.json();
    console.log('API Response:', JSON.stringify(data, null, 2));

    if (res.status === 200 && data.success) {
        console.log('✅ GET /api/admin/disputes returned 200 OK successfully!');
    } else {
        console.error('❌ Failed:', data);
    }
}

testGetDisputesApi()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
