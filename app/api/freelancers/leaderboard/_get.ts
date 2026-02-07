import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const leaderboardSchema = z.object({
    scope: z.enum(['india', 'local', 'state']).optional().default('india'),
    userId: z.string().optional(),
    limit: z.string().optional().transform(v => v ? parseInt(v) : 50)
});

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const params = Object.fromEntries(searchParams.entries());

        const validation = await validateParams(Promise.resolve(params), leaderboardSchema);
        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { scope, userId, limit } = validation.data;

        let cityFilter: string | null = null;
        let stateFilter: string | null = null;
        let countryFilter: string | null = 'India';

        if ((scope === 'local' || scope === 'state') && userId) {
            const freelancer = await db
                .selectFrom('freelancers')
                .select(['city', 'state'])
                .where('userId', '=', userId)
                .executeTakeFirst();

            if (freelancer) {
                if (scope === 'local' && freelancer.city) {
                    cityFilter = freelancer.city;
                    countryFilter = null; // Prioritize city
                } else if (scope === 'state' && freelancer.state) {
                    stateFilter = freelancer.state;
                    countryFilter = null; // Prioritize state
                }
            }
        }

        let query = db
            .selectFrom('freelancers')
            .innerJoin('users', 'users.id', 'freelancers.userId')
            .select([
                'freelancers.id',
                'freelancers.userId',
                'freelancers.xp',
                'freelancers.level',
                'freelancers.assignedJobs',
                'freelancers.profilePhoto',
                'freelancers.totalEarnings',
                'users.fullName'
            ]);

        if (cityFilter) {
            query = query.where('freelancers.city', 'ilike', `%${cityFilter}%`);
        } else if (stateFilter) {
            query = query.where('freelancers.state', 'ilike', `%${stateFilter}%`);
        } else if (countryFilter) {
            query = query.where('freelancers.country', 'ilike', `%${countryFilter}%`);
        }

        const freelancers = await query
            .orderBy('freelancers.xp', 'desc')
            .orderBy('freelancers.totalEarnings', 'desc')
            .limit(limit)
            .execute();

        const leaderboard = freelancers.map(f => ({
            ...f,
            orderCount: Array.isArray(f.assignedJobs) ? (f.assignedJobs as any[]).length : 0,
            full_name: f.fullName,
            assignedJobs: f.assignedJobs || []
        }));

        return NextResponse.json({
            success: true,
            data: leaderboard
        });

    } catch (error: any) {
        console.error('Leaderboard error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
