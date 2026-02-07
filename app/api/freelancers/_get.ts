import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const listFreelancersSchema = z.object({
    page: z.string().optional().default('1').transform(v => parseInt(v)),
    limit: z.string().optional().default('10').transform(v => parseInt(v)),
    city: z.string().optional(),
    state: z.string().optional(),
    experience: z.string().optional().transform(v => v ? parseInt(v) : undefined),
    currentlyAvailable: z.string().optional().transform(v => v === 'true'),
    skills: z.string().optional().transform(v => v ? v.split(',') : undefined)
});

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const params = Object.fromEntries(searchParams.entries());

        const validation = await validateParams(Promise.resolve(params), listFreelancersSchema);
        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { page, limit, city, state, experience, currentlyAvailable, skills } = validation.data;
        const skip = (page - 1) * limit;

        let query = db
            .selectFrom('freelancers')
            .selectAll('freelancers')
            .innerJoin('users', 'users.id', 'freelancers.userId')
            .select(['users.fullName', 'users.email']);

        // Apply filters
        if (city) {
            query = query.where('freelancers.city', 'ilike', `%${city}%`);
        }
        if (state) {
            query = query.where('freelancers.state', 'ilike', `%${state}%`);
        }
        if (experience !== undefined) {
            query = query.where('freelancers.experience', '>=', experience);
        }
        if (currentlyAvailable !== undefined) {
            query = query.where('freelancers.currentlyAvailable', '=', currentlyAvailable);
        }
        // Note: Skills filtering (array_contains) might need specific Postgres handling/Json check
        // Kysely JSON operations can be complex. For now, skipping advanced JSON array filtering
        // or using simple check if possible.
        // Assuming roleDesignation stores skills as text[] or json

        // Count query
        // const countResult = await query.select(({ fn }) => fn.countAll().as('count')).executeTakeFirst();
        // The above count query is slightly wrong because of how Kysely handles clones/joins.
        // Better to do a separate count query or windows function.

        // Simplified count
        const totalQuery = db.selectFrom('freelancers');
        let totalQ = totalQuery.select(({ fn }) => fn.count('id').as('count'));
        // Apply same filters to totalQ... (a bit repetitive, but safest without refactoring query builder)
        if (city) totalQ = totalQ.where('city', 'ilike', `%${city}%`);
        if (state) totalQ = totalQ.where('state', 'ilike', `%${state}%`);
        if (experience !== undefined) totalQ = totalQ.where('experience', '>=', experience);
        if (currentlyAvailable !== undefined) totalQ = totalQ.where('currentlyAvailable', '=', currentlyAvailable);

        const [freelancers, countResult] = await Promise.all([
            query
                .orderBy('freelancers.rating', 'desc')
                .orderBy('freelancers.createdAt', 'desc')
                .limit(limit)
                .offset(skip)
                .execute(),
            totalQ.executeTakeFirst()
        ]);

        const total = Number(countResult?.count || 0);

        // Map results to include user object structure expected by frontend
        const mappedFreelancers = freelancers.map(f => ({
            ...f,
            user: {
                id: f.userId, // Available because of selectAll('freelancers') includes userId
                email: f.email,
                fullName: f.fullName
            }
        }));

        return NextResponse.json({
            success: true,
            message: 'Freelancers retrieved successfully',
            data: {
                freelancers: mappedFreelancers,
                total,
                page,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error: any) {
        console.error('List freelancers error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
