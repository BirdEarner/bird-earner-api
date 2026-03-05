import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id: userId, role: tokenRole } = user;
        let stats = {};
        let activeRole = tokenRole;

        // If generic role, try to detect from database
        if (activeRole === 'USER' || activeRole === 'user') {
            const freelancerProfile = await db.selectFrom('freelancers').select('id').where('userId', '=', userId).executeTakeFirst();
            const clientProfile = await db.selectFrom('clients').select('id').where('userId', '=', userId).executeTakeFirst();

            if (freelancerProfile) activeRole = 'freelancer';
            else if (clientProfile) activeRole = 'client';
        }

        if (activeRole === 'freelancer') {
            const freelancer = await db
                .selectFrom('freelancers')
                .selectAll()
                .where('userId', '=', userId)
                .executeTakeFirst();

            if (freelancer) {
                const jobs = await db
                    .selectFrom('jobs')
                    .select(['jobStatus'])
                    .where('assignedFreelancerId', '=', freelancer.id)
                    .execute();

                const completedJobs = jobs.filter(j => j.jobStatus === 'COMPLETED').length;
                const activeJobs = jobs.filter(j => j.jobStatus === 'IN_PROGRESS' || j.jobStatus === 'OPEN').length;
                const cancelledJobs = jobs.filter(j => j.jobStatus === 'CANCELLED').length;

                const completedJobDetails = await db
                    .selectFrom('jobs')
                    .select(['budgetAmount', 'completedAt'])
                    .where('assignedFreelancerId', '=', freelancer.id)
                    .where('jobStatus', '=', 'COMPLETED')
                    .execute();

                const monthlyMap: Record<string, number> = {};
                completedJobDetails.forEach(job => {
                    if (job.completedAt) {
                        const month = new Date(job.completedAt).toLocaleString('default', { month: 'short' });
                        monthlyMap[month] = (monthlyMap[month] || 0) + (Number(job.budgetAmount) || 0);
                    }
                });

                const chartData = Object.entries(monthlyMap).map(([name, earnings]) => ({ name, earnings }));

                stats = {
                    totalEarnings: freelancer.totalEarnings,
                    monthlyEarnings: freelancer.monthlyEarnings,
                    outstandingAmount: freelancer.outstandingAmount,
                    withdrawableAmount: freelancer.withdrawableAmount,
                    xp: freelancer.xp,
                    level: freelancer.level,
                    rating: freelancer.rating,
                    completedJobs,
                    activeJobs,
                    cancelledJobs,
                    profileViews: 0,
                    chartData
                };
            }

            return NextResponse.json({ success: true, data: stats });
        }

        if (activeRole === 'client') {
            const client = await db
                .selectFrom('clients')
                .selectAll()
                .where('userId', '=', userId)
                .executeTakeFirst();

            if (client) {
                const jobs = await db
                    .selectFrom('jobs')
                    .select(['jobStatus', 'budgetAmount', 'completedAt', 'createdAt'])
                    .where('clientId', '=', client.id)
                    .execute();

                const postedJobs = jobs.length;
                const activeJobs = jobs.filter(j => j.jobStatus === 'IN_PROGRESS' || j.jobStatus === 'OPEN').length;
                const completedJobs = jobs.filter(j => j.jobStatus === 'COMPLETED').length;
                const cancelledJobs = jobs.filter(j => j.jobStatus === 'CANCELLED').length;

                // Total spent = sum of budgetAmount for all COMPLETED jobs
                const totalSpent = jobs
                    .filter(j => j.jobStatus === 'COMPLETED')
                    .reduce((sum, j) => sum + (Number(j.budgetAmount) || 0), 0);

                // Monthly spent = sum of budgetAmount for COMPLETED jobs in current month
                const now = new Date();
                const currentMonth = now.getMonth();
                const currentYear = now.getFullYear();
                const monthlySpent = jobs
                    .filter(j => {
                        if (j.jobStatus !== 'COMPLETED' || !j.completedAt) return false;
                        const d = new Date(j.completedAt);
                        return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
                    })
                    .reduce((sum, j) => sum + (Number(j.budgetAmount) || 0), 0);

                // Monthly chart data grouped by month of creation
                const monthlyMap: Record<string, number> = {};
                jobs.forEach(job => {
                    if (job.createdAt) {
                        const month = new Date(job.createdAt).toLocaleString('default', { month: 'short' });
                        monthlyMap[month] = (monthlyMap[month] || 0) + (Number(job.budgetAmount) || 0);
                    }
                });
                const chartData = Object.entries(monthlyMap).map(([name, spent]) => ({ name, spent }));

                stats = {
                    walletBalance: client.wallet,
                    availableBalance: client.availableBalance,
                    reservedAmount: client.reservedAmount,
                    level: client.level ?? 1,
                    xp: client.xp ?? 0,
                    rating: client.rating ?? 0,
                    postedJobs,
                    activeJobs,
                    completedJobs,
                    cancelledJobs,
                    totalSpent,
                    monthlySpent,
                    chartData
                };
            }

            return NextResponse.json({ success: true, data: stats });
        }

        // Admin or other unsupported roles
        return NextResponse.json({ message: 'Role not supported for dashboard stats' }, { status: 400 });

    } catch (error: any) {
        console.error('Dashboard stats error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
