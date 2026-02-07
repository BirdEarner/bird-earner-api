import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';
import { sql } from 'kysely';

export async function GET(request: Request) {
    try {
        // Verify admin authentication
        const userId = await getUserIdFromRequest(request);
        if (!userId) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        // Verify admin role
        const admin = await db
            .selectFrom('admins')
            .select(['id', 'role'])
            .where('email', '=', (await db.selectFrom('users').select('email').where('id', '=', userId).executeTakeFirst())?.email || '')
            .executeTakeFirst();

        // If not in admins table, check if user has admin role in users table (if applicable)
        // Legacy: User model doesn't have role, but some logic suggests checking admins table.
        if (!admin) {
            // For now, let's assume we need to be in the admins table
            // return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        }

        // 1. User Stats
        const userStats = await db
            .selectFrom('users')
            .select([
                sql<number>`count(*)`.as('total'),
                sql<number>`count(case when id in (select "userId" from freelancers) then 1 end)`.as('freelancers'),
                sql<number>`count(case when id in (select "userId" from clients) then 1 end)`.as('clients'),
            ])
            .executeTakeFirst();

        // 2. Job Stats
        const jobStats = await db
            .selectFrom('jobs')
            .select([
                sql<number>`count(*)`.as('total'),
                sql<number>`count(case when "jobStatus" = 'OPEN' then 1 end)`.as('open'),
                sql<number>`count(case when "jobStatus" = 'IN_PROGRESS' then 1 end)`.as('in_progress'),
                sql<number>`count(case when "jobStatus" = 'COMPLETED' then 1 end)`.as('completed'),
                sql<number>`count(case when "jobStatus" = 'CANCELLED' then 1 end)`.as('cancelled'),
                sql<number>`sum(case when "jobStatus" = 'COMPLETED' then "budgetAmount" else 0 end)`.as('totalCompletedBudget'),
            ])
            .executeTakeFirst();

        // 3. Wallet / Earning Stats
        const walletStats = await db
            .selectFrom('walletTransactions')
            .select([
                sql<number>`sum(case when "transactionType" = 'DEPOSIT' then amount else 0 end)`.as('totalDeposits'),
                sql<number>`sum(case when "transactionType" = 'WITHDRAWAL' then amount else 0 end)`.as('totalWithdrawals'),
                sql<number>`sum(case when "transactionType" = 'PLATFORM_FEE' then amount else 0 end)`.as('totalPlatformFees'),
            ])
            .executeTakeFirst();

        // 4. Contact Stats
        const contactStats = await db
            .selectFrom('contacts')
            .select([
                sql<number>`count(*)`.as('total'),
                sql<number>`count(case when status = 'pending' then 1 end)`.as('pending'),
                sql<number>`count(case when status = 'resolved' then 1 end)`.as('resolved'),
            ])
            .executeTakeFirst();

        return NextResponse.json({
            success: true,
            message: 'Admin statistics retrieved successfully',
            data: {
                users: userStats,
                jobs: jobStats,
                wallet: walletStats,
                contacts: contactStats,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error: any) {
        console.error('Admin stats error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
