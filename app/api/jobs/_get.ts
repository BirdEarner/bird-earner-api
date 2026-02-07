import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const listJobsSchema = z.object({
    page: z.string().optional().transform(v => parseInt(v || '1', 10)),
    limit: z.string().optional().transform(v => parseInt(v || '10', 10)),
    status: z.string().optional(),
    category: z.string().optional(),
    clientId: z.string().optional(),
    freelancerId: z.string().optional(),
    search: z.string().optional(),
});

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const params = Object.fromEntries(searchParams.entries());

        const validation = await validateParams(Promise.resolve(params), listJobsSchema);
        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { page, limit, status, category, clientId, freelancerId, search } = validation.data;
        const offset = (page - 1) * limit;

        let query = db
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .innerJoin('users', 'users.id', 'clients.userId')
            .leftJoin('services', 'services.id', 'jobs.serviceId')
            .select([
                'jobs.id',
                'jobs.jobTitle',
                'jobs.jobDescription',
                'jobs.jobCategory',
                'jobs.budgetAmount',
                'jobs.jobStatus',
                'jobs.createdAt',
                'jobs.isUrgent',
                'users.fullName as clientName',
                'clients.companyName',
                'services.name as serviceName'
            ]);

        if (status) query = query.where('jobs.jobStatus', '=', status as any);
        if (category) query = query.where('jobs.jobCategory', '=', category);
        if (clientId) query = query.where('jobs.clientId', '=', clientId);
        if (freelancerId) query = query.where('jobs.assignedFreelancerId', '=', freelancerId);
        if (search) {
            query = query.where((eb) =>
                eb.or([
                    eb('jobs.jobTitle', 'ilike', `%${search}%`),
                    eb('jobs.jobDescription', 'ilike', `%${search}%`)
                ])
            );
        }

        const [jobs, totalCountResult] = await Promise.all([
            query.orderBy('jobs.createdAt', 'desc').limit(limit).offset(offset).execute(),
            query.select(db.fn.count('jobs.id').as('count')).executeTakeFirst()
        ]);

        const total = Number(totalCountResult?.count || 0);

        return NextResponse.json({
            success: true,
            message: 'Jobs retrieved successfully',
            data: {
                jobs,
                total,
                page,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('List jobs error:', error);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}
