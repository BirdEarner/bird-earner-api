import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
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
        const authUser = await getAuthUser();
        const currentUserId = authUser?.id || null;

        const { searchParams } = new URL(request.url);
        const params = Object.fromEntries(searchParams.entries());

        const validation = await validateParams(Promise.resolve(params), listJobsSchema);
        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { page, limit, status, category, clientId, freelancerId, search } = validation.data;
        const offset = (page - 1) * limit;

        // Calculate 3 days ago for cancelled job visibility
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        let query = db
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .innerJoin('users', 'users.id', 'clients.userId')
            .leftJoin('services', 'services.id', 'jobs.serviceId')
            .where('jobs.deleted', '=', false)
            .where((eb) =>
                eb.or([
                    eb('jobs.jobStatus', '!=', 'CANCELLED'),
                    eb.and([
                        eb('jobs.jobStatus', '=', 'CANCELLED'),
                        eb('jobs.cancelledAt', '>=', threeDaysAgo)
                    ])
                ])
            )
            .select([
                'jobs.id',
                'jobs.jobTitle',
                'jobs.jobDescription',
                'jobs.jobCategory',
                'jobs.jobSubCategory',
                'jobs.projectType',
                'jobs.budgetType',
                'jobs.budgetAmount',
                'jobs.jobStatus',
                'jobs.paymentMethod',
                'jobs.paymentStatus',
                'jobs.location',
                'jobs.latitude',
                'jobs.longitude',
                'jobs.createdAt',
                'jobs.assignedFreelancerId',
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

        const countQuery = db.selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .select(db.fn.count('jobs.id').as('count'))
            .where('jobs.deleted', '=', false)
            .where((eb) =>
                eb.or([
                    eb('jobs.jobStatus', '!=', 'CANCELLED'),
                    eb.and([
                        eb('jobs.jobStatus', '=', 'CANCELLED'),
                        eb('jobs.cancelledAt', '>=', threeDaysAgo)
                    ])
                ])
            )
            .$if(!!status, (qb) => qb.where('jobs.jobStatus', '=', status as any))
            .$if(!!category, (qb) => qb.where('jobs.jobCategory', '=', category!))
            .$if(!!clientId, (qb) => qb.where('jobs.clientId', '=', clientId!))
            .$if(!!freelancerId, (qb) => qb.where('jobs.assignedFreelancerId', '=', freelancerId!))
            .$if(!!search, (qb) => qb.where((eb) => eb.or([
                eb('jobs.jobTitle', 'ilike', `%${search}%`),
                eb('jobs.jobDescription', 'ilike', `%${search}%`)
            ])));

        const [jobs, totalCountResult] = await Promise.all([
            query.orderBy('jobs.createdAt', 'desc').limit(limit).offset(offset).execute(),
            countQuery.executeTakeFirst()
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
