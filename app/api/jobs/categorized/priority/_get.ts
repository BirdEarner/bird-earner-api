import { db } from '@/lib/db';
import { categorizeJobsByPriority } from '@/lib/utils/priority';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const priorityFiltersSchema = z.object({
    status: z.string().optional().default('OPEN'),
    category: z.string().optional(),
    clientId: z.string().optional(),
    freelancerId: z.string().optional(),
    serviceId: z.string().optional(),
    budgetMin: z.string().optional().transform(v => v ? parseFloat(v) : undefined),
    budgetMax: z.string().optional().transform(v => v ? parseFloat(v) : undefined),
    isUrgent: z.string().optional().transform(v => v === 'true'),
});

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const params = Object.fromEntries(searchParams.entries());

        const validation = await validateParams(Promise.resolve(params), priorityFiltersSchema);
        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const filters = validation.data;

        let query = db
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .innerJoin('users', 'users.id', 'clients.userId')
            .select([
                'jobs.id',
                'jobs.jobTitle',
                'jobs.jobDescription',
                'jobs.jobCategory',
                'jobs.budgetAmount',
                'jobs.jobStatus',
                'jobs.createdAt',
                'jobs.isUrgent',
                'jobs.deadlineDate',
                'users.fullName as clientName',
                'clients.companyName',
                'clients.profilePhoto as clientPhoto'
            ]);

        if (filters.status) query = query.where('jobs.jobStatus', '=', filters.status as any);
        if (filters.category) query = query.where('jobs.jobCategory', '=', filters.category);
        if (filters.clientId) query = query.where('jobs.clientId', '=', filters.clientId);
        if (filters.freelancerId) query = query.where('jobs.assignedFreelancerId', '=', filters.freelancerId);
        if (filters.budgetMin) query = query.where('jobs.budgetAmount', '>=', filters.budgetMin.toString());
        if (filters.budgetMax) query = query.where('jobs.budgetAmount', '<=', filters.budgetMax.toString());
        if (filters.isUrgent) query = query.where('jobs.isUrgent', '=', true);

        const jobs = await query.orderBy('jobs.createdAt', 'desc').execute();
        const categorized = await categorizeJobsByPriority(jobs, filters.serviceId || null);

        return NextResponse.json({
            success: true,
            message: 'Jobs categorized by priority successfully',
            data: categorized,
            meta: {
                totalJobs: jobs.length,
                counts: {
                    immediate: categorized.Immediate.length,
                    high: categorized.High.length,
                    standard: categorized.Standard.length,
                }
            }
        });
    } catch (error) {
        console.error('Categorized jobs error:', error);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}
