import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET() {
    try {
        const clientId = '8ab37d98-c534-49f1-8ab0-813903186304';

        const existingJobs = await db
            .selectFrom('jobs')
            .select('id')
            .where('clientId', '=', clientId)
            .where('jobStatus', '=', 'COMPLETED')
            .execute();

        if (existingJobs.length === 0) {
            const now = new Date();
            const jobs = [];
            for (let i = 0; i < 3; i++) {
                const completedAt = new Date(now.getTime() - (2 - i) * 86400000);
                jobs.push({
                    id: crypto.randomUUID(),
                    clientId,
                    jobTitle: `Test Job ${i + 1}`,
                    jobDescription: `Seed job ${i + 1} for testing egg offers`,
                    jobCategory: 'Development',
                    jobSubCategory: 'Web Development',
                    skillsRequired: JSON.stringify(['testing']),
                    projectType: 'FIXED',
                    budgetType: 'FIXED',
                    budgetAmount: (500 + i * 100).toString(),
                    jobStatus: 'COMPLETED' as const,
                    proposalCount: 0,
                    paymentMethod: 'PLATFORM',
                    birdFeePaid: false,
                    isAmountReserved: false,
                    paymentStatus: 'PENDING' as const,
                    createdAt: completedAt,
                    updatedAt: now,
                    completedAt,
                });
            }

            await db.insertInto('jobs').values(jobs).execute();

            return NextResponse.json({
                success: true,
                message: 'Created 3 completed jobs. Restart app and test.',
            });
        }

        const offers = await db
            .selectFrom('cashbackOffers')
            .selectAll()
            .where('clientId', '=', clientId)
            .execute();

        const discovered = offers.filter(o => o.discovered);
        if (discovered.length > 0) {
            await db
                .updateTable('cashbackOffers')
                .set({ discovered: false, updatedAt: new Date() })
                .where('clientId', '=', clientId)
                .where('discovered', '=', true)
                .execute();
        }

        return NextResponse.json({
            success: true,
            message: `Found ${existingJobs.length} completed jobs, ${offers.length} offers (${discovered.length} discovered → reset). Restart app and test.`,
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
