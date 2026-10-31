import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

type DashboardRole = 'freelancer' | 'client';

function normalizeRole(role: unknown): string {
    return String(role || '').trim().toLowerCase();
}

function toNumber(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

async function resolveActiveRole(
    userId: string,
    tokenRole: string,
    requestedRole: string | null
): Promise<DashboardRole | null> {
    const freelancerProfile = await db
        .selectFrom('freelancers')
        .select('id')
        .where('userId', '=', userId)
        .executeTakeFirst();
    const clientProfile = await db
        .selectFrom('clients')
        .select('id')
        .where('userId', '=', userId)
        .executeTakeFirst();

    const hasFreelancer = !!freelancerProfile;
    const hasClient = !!clientProfile;

    // Prefer an explicit UI role switch when the user owns that profile
    const requested = normalizeRole(requestedRole);
    if (requested === 'freelancer' && hasFreelancer) return 'freelancer';
    if (requested === 'client' && hasClient) return 'client';

    const token = normalizeRole(tokenRole);
    if ((token === 'freelancer' || token === 'freelancers') && hasFreelancer) return 'freelancer';
    if ((token === 'client' || token === 'clients') && hasClient) return 'client';

    // Token may be USER / ADMIN / mismatched casing — fall back to owned profiles
    if (hasFreelancer && !hasClient) return 'freelancer';
    if (hasClient && !hasFreelancer) return 'client';
    if (hasClient) return 'client';
    if (hasFreelancer) return 'freelancer';

    return null;
}

async function getFreelancerStats(userId: string) {
    const freelancer = await db
        .selectFrom('freelancers')
        .selectAll()
        .where('userId', '=', userId)
        .executeTakeFirst();

    if (!freelancer) {
        return {
            totalEarnings: 0,
            monthlyEarnings: 0,
            outstandingAmount: 0,
            withdrawableAmount: 0,
            xp: 0,
            level: 1,
            rating: 0,
            completedJobs: 0,
            activeJobs: 0,
            cancelledJobs: 0,
            profileViews: 0,
            chartData: [] as { name: string; earnings: number }[],
        };
    }

    const jobs = await db
        .selectFrom('jobs')
        .select(['jobStatus'])
        .where('assignedFreelancerId', '=', freelancer.id)
        .where('deleted', '=', false)
        .execute();

    const completedJobs = jobs.filter((j) => j.jobStatus === 'COMPLETED').length;
    const activeJobs = jobs.filter(
        (j) => j.jobStatus === 'IN_PROGRESS' || j.jobStatus === 'OPEN'
    ).length;
    const cancelledJobs = jobs.filter((j) => j.jobStatus === 'CANCELLED').length;

    const completedJobDetails = await db
        .selectFrom('jobs')
        .select(['budgetAmount', 'completedAt'])
        .where('assignedFreelancerId', '=', freelancer.id)
        .where('deleted', '=', false)
        .where('jobStatus', '=', 'COMPLETED')
        .execute();

    const monthlyMap: Record<string, number> = {};
    completedJobDetails.forEach((job) => {
        if (job.completedAt) {
            const month = new Date(job.completedAt).toLocaleString('default', {
                month: 'short',
            });
            monthlyMap[month] =
                (monthlyMap[month] || 0) + toNumber(job.budgetAmount);
        }
    });

    const chartData = Object.entries(monthlyMap).map(([name, earnings]) => ({
        name,
        earnings,
    }));

    return {
        totalEarnings: toNumber(freelancer.totalEarnings),
        monthlyEarnings: toNumber(freelancer.monthlyEarnings),
        outstandingAmount: toNumber(freelancer.outstandingAmount),
        withdrawableAmount: toNumber(freelancer.withdrawableAmount),
        xp: toNumber(freelancer.xp),
        level: toNumber(freelancer.level, 1),
        rating: toNumber(freelancer.rating),
        completedJobs,
        activeJobs,
        cancelledJobs,
        profileViews: 0,
        chartData,
    };
}

async function getClientStats(userId: string) {
    const client = await db
        .selectFrom('clients')
        .selectAll()
        .where('userId', '=', userId)
        .executeTakeFirst();

    if (!client) {
        return {
            walletBalance: 0,
            availableBalance: 0,
            reservedAmount: 0,
            postedJobs: 0,
            activeJobs: 0,
            completedJobs: 0,
            cancelledJobs: 0,
            totalSpent: 0,
            monthlySpent: 0,
            chartData: [] as { name: string; spent: number }[],
        };
    }

    const jobs = await db
        .selectFrom('jobs')
        .select(['jobStatus', 'budgetAmount', 'completedAt', 'createdAt'])
        .where('clientId', '=', client.id)
        .where('deleted', '=', false)
        .execute();

    const postedJobs = jobs.length;
    const activeJobs = jobs.filter(
        (j) => j.jobStatus === 'IN_PROGRESS' || j.jobStatus === 'OPEN'
    ).length;
    const completedJobs = jobs.filter((j) => j.jobStatus === 'COMPLETED').length;
    const cancelledJobs = jobs.filter((j) => j.jobStatus === 'CANCELLED').length;

    const totalSpent = jobs
        .filter((j) => j.jobStatus === 'COMPLETED')
        .reduce((sum, j) => sum + toNumber(j.budgetAmount), 0);

    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const monthlySpent = jobs
        .filter((j) => {
            if (j.jobStatus !== 'COMPLETED' || !j.completedAt) return false;
            const d = new Date(j.completedAt);
            return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
        })
        .reduce((sum, j) => sum + toNumber(j.budgetAmount), 0);

    const monthlyMap: Record<string, number> = {};
    jobs.forEach((job) => {
        if (job.createdAt) {
            const month = new Date(job.createdAt).toLocaleString('default', {
                month: 'short',
            });
            monthlyMap[month] =
                (monthlyMap[month] || 0) + toNumber(job.budgetAmount);
        }
    });
    const chartData = Object.entries(monthlyMap).map(([name, spent]) => ({
        name,
        spent,
    }));

    return {
        walletBalance: toNumber(client.wallet),
        availableBalance: toNumber(client.availableBalance),
        reservedAmount: toNumber(client.reservedAmount),
        postedJobs,
        activeJobs,
        completedJobs,
        cancelledJobs,
        totalSpent,
        monthlySpent,
        chartData,
    };
}

export async function GET(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const requestedRole = searchParams.get('role');

        const activeRole = await resolveActiveRole(
            user.id,
            user.role,
            requestedRole
        );

        if (!activeRole) {
            // Authenticated but no client/freelancer profile yet — empty dashboard, not an error
            return NextResponse.json({
                success: true,
                data: {},
                role: null,
            });
        }

        const stats =
            activeRole === 'freelancer'
                ? await getFreelancerStats(user.id)
                : await getClientStats(user.id);

        return NextResponse.json({
            success: true,
            data: stats,
            role: activeRole,
        });
    } catch (error: any) {
        console.error('Dashboard stats error:', error);
        return NextResponse.json(
            {
                success: false,
                message: error.message || 'Server error',
            },
            { status: 500 }
        );
    }
}
