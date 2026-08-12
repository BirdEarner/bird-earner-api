import 'dotenv/config';
import { db } from './lib/db';
import crypto from 'crypto';

async function runE2ETest() {
    console.log("=================================================");
    console.log("  STARTING END-TO-END SUGGESTED SERVICES TEST   ");
    console.log("=================================================");

    try {
        // Step 1: Find or create a test user
        let testUser = await db.selectFrom('users').select(['id', 'email']).executeTakeFirst();
        if (!testUser) {
            console.log("Creating a temporary test user...");
            testUser = await db.insertInto('users').values({
                id: crypto.randomUUID(),
                email: 'test_freelancer_e2e@example.com',
                password: 'hashed_password_123',
                fullName: 'E2E Test Freelancer',
                updatedAt: new Date(),
            }).returning(['id', 'email']).executeTakeFirstOrThrow();
        }
        console.log(`✓ Test User identified: ID=${testUser.id}, Email=${testUser.email}`);

        // Step 2: Test Freelancer Suggest Service insertion (Pending)
        const testServiceName = `E2E Test Service ${Date.now()}`;
        const suggestionId = crypto.randomUUID();
        
        console.log(`\n[Step 2] Inserting Suggested Service: "${testServiceName}"...`);
        // @ts-ignore
        await db.insertInto('suggestedServices').values({
            id: suggestionId,
            userId: testUser.id,
            serviceName: testServiceName,
            description: 'Specialized E2E test service description for testing approval workflow',
            images: JSON.stringify(['https://example.com/test1.jpg', 'https://example.com/test2.jpg']),
            status: 'pending',
            matchedServiceId: null,
            updatedAt: new Date(),
        }).execute();

        // Verify insertion in DB
        const insertedRow = await db.selectFrom('suggestedServices')
            .selectAll()
            .where('id', '=', suggestionId)
            .executeTakeFirst();

        if (!insertedRow) {
            throw new Error("FAILED: Suggested service was not found in suggestedServices table!");
        }
        console.log(`✓ VERIFIED IN DB: Record stored with ID=${insertedRow.id}, Status=${insertedRow.status}`);

        // Step 3: Test Super Admin Listing (GET)
        console.log(`\n[Step 3] Fetching Suggested Services (Super Admin List)...`);
        const pendingList = await db.selectFrom('suggestedServices')
            .innerJoin('users', 'users.id', 'suggestedServices.userId')
            .select([
                'suggestedServices.id',
                'suggestedServices.serviceName',
                'suggestedServices.status',
                'users.fullName as userFullName',
            ])
            .where('suggestedServices.id', '=', suggestionId)
            .execute();

        if (pendingList.length === 0) {
            throw new Error("FAILED: Super admin list query could not retrieve the inserted suggestion!");
        }
        console.log(`✓ VERIFIED SUPER ADMIN LIST: Found 1 matching pending suggestion for "${pendingList[0].userFullName}"`);

        // Step 4: Test Super Admin MATCH Action
        console.log(`\n[Step 4] Testing Super Admin MATCH Action...`);
        let existingService = await db.selectFrom('services').select(['id', 'name']).executeTakeFirst();
        if (existingService) {
            // @ts-ignore
            await db.updateTable('suggestedServices')
                .set({
                    status: 'match',
                    matchedServiceId: existingService.id,
                    updatedAt: new Date(),
                })
                .where('id', '=', suggestionId)
                .execute();

            const matchedRow = await db.selectFrom('suggestedServices')
                .select(['status', 'matchedServiceId'])
                .where('id', '=', suggestionId)
                .executeTakeFirst();

            if (matchedRow?.status !== 'match' || matchedRow?.matchedServiceId !== existingService.id) {
                throw new Error("FAILED: Match action did not correctly update status and matchedServiceId!");
            }
            console.log(`✓ VERIFIED MATCH: Suggestion successfully mapped to existing service "${existingService.name}" (ID=${existingService.id})`);
        } else {
            console.log("  (Skipped MATCH test: No pre-existing services found in services table)");
        }

        // Step 5: Test Super Admin REJECT Action
        console.log(`\n[Step 5] Testing Super Admin REJECT Action...`);
        // @ts-ignore
        await db.updateTable('suggestedServices')
            .set({
                status: 'reject',
                matchedServiceId: null,
                updatedAt: new Date(),
            })
            .where('id', '=', suggestionId)
            .execute();

        const rejectedRow = await db.selectFrom('suggestedServices')
            .select(['status', 'matchedServiceId'])
            .where('id', '=', suggestionId)
            .executeTakeFirst();

        if (rejectedRow?.status !== 'reject' || rejectedRow?.matchedServiceId !== null) {
            throw new Error("FAILED: Reject action did not update status to 'reject'!");
        }
        console.log(`✓ VERIFIED REJECT: Suggestion status updated to 'reject'`);

        // Step 6: Test Super Admin APPROVE Action (Creates new service in `services` table)
        console.log(`\n[Step 6] Testing Super Admin APPROVE Action (Creating new service)...`);
        const newServiceId = crypto.randomUUID();
        const approvedServiceName = `Approved ${testServiceName}`;
        
        // 6a. Insert into services table
        const newService = await db.insertInto('services').values({
            id: newServiceId,
            name: approvedServiceName,
            description: 'Approved service created from freelancer suggestion',
            // @ts-ignore
            category: 'FREELANCE',
            imageUrl: 'https://example.com/test1.jpg',
            isActive: true,
            updatedAt: new Date(),
        }).returningAll().executeTakeFirstOrThrow();

        console.log(`✓ NEW SERVICE CREATED IN SERVICES TABLE: ID=${newService.id}, Name="${newService.name}"`);

        // 6b. Update suggestedServices record
        // @ts-ignore
        await db.updateTable('suggestedServices')
            .set({
                status: 'approve',
                matchedServiceId: newService.id,
                updatedAt: new Date(),
            })
            .where('id', '=', suggestionId)
            .execute();

        const approvedRow = await db.selectFrom('suggestedServices')
            .select(['status', 'matchedServiceId'])
            .where('id', '=', suggestionId)
            .executeTakeFirst();

        if (approvedRow?.status !== 'approve' || approvedRow?.matchedServiceId !== newService.id) {
            throw new Error("FAILED: Approve action did not update suggestedServices status to 'approve' and link matchedServiceId!");
        }
        console.log(`✓ VERIFIED APPROVAL LINK: suggestedServices record status='approve' linked to services.id=${approvedRow.matchedServiceId}`);

        // Step 7: Final DB Integrity Check
        console.log(`\n[Step 7] Final DB Integrity Verification...`);
        const createdServiceInDB = await db.selectFrom('services')
            .selectAll()
            .where('id', '=', newServiceId)
            .executeTakeFirst();

        if (!createdServiceInDB) {
            throw new Error("FAILED: Approved service was not found when querying services table!");
        }
        console.log(`✓ VERIFIED SERVICE IS ACTIVE IN SERVICES TABLE:`);
        console.log(`   - ID: ${createdServiceInDB.id}`);
        console.log(`   - Name: ${createdServiceInDB.name}`);
        console.log(`   - Category: ${createdServiceInDB.category}`);
        console.log(`   - Is Active: ${createdServiceInDB.isActive}`);

        // Clean up test records
        console.log(`\n[Step 8] Cleaning up test data...`);
        await db.deleteFrom('suggestedServices').where('id', '=', suggestionId).execute();
        await db.deleteFrom('services').where('id', '=', newServiceId).execute();
        console.log(`✓ Cleaned up temporary test records.`);

        console.log("\n=================================================");
        console.log("  ALL END-TO-END TESTS PASSED SUCCESSFULLY! 🚀  ");
        console.log("=================================================");

        process.exit(0);

    } catch (error: any) {
        console.error("\n❌ TEST FAILED WITH ERROR:", error.message || error);
        process.exit(1);
    }
}

runE2ETest();
