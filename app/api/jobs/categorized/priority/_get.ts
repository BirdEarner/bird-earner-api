import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { categorizeJobsByPriority } from '@/lib/utils/priority';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const priorityFiltersSchema = z.object({
    status: z.string().optional().default('OPEN'),
    category: z.string().optional(),
    clientId: z.string().optional(),
    freelancerId: z.string().optional(),
    currentFreelancerId: z.string().optional(),
    serviceId: z.string().optional(),
    serviceIds: z.string().optional(),
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
            .leftJoin('services', 'services.id', 'jobs.serviceId')
            .where('jobs.deleted', '=', false)
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
                'jobs.isUrgent',
                'jobs.assignedFreelancerId',
                'jobs.deadlineDate',
                'jobs.serviceId',
                'services.name as serviceName',
                'users.fullName as clientName',
                'users.id as clientUserId',
                'clients.companyName',
                'clients.profilePhoto as clientPhoto',
                'clients.id as clientId'
            ]);

        const user = await getAuthUser();
        let currentUserId = user?.id || null;

        if (!currentUserId && filters.currentFreelancerId) {
            const f = await db.selectFrom('freelancers').select('userId').where('id', '=', filters.currentFreelancerId).executeTakeFirst();
            if (f) currentUserId = f.userId;
        }

        if (filters.status) query = query.where('jobs.jobStatus', '=', filters.status as any);
        if (filters.category) query = query.where('jobs.jobCategory', '=', filters.category);
        if (filters.clientId) query = query.where('jobs.clientId', '=', filters.clientId);
        if (filters.freelancerId) query = query.where('jobs.assignedFreelancerId', '=', filters.freelancerId);
        if (filters.budgetMin) query = query.where('jobs.budgetAmount', '>=', filters.budgetMin.toString());
        if (filters.budgetMax) query = query.where('jobs.budgetAmount', '<=', filters.budgetMax.toString());
        if (filters.isUrgent) query = query.where('jobs.isUrgent', '=', true);

        // Filter by multiple service IDs (comma-separated)
        if (filters.serviceIds) {
            const serviceIds = filters.serviceIds.split(',').filter(Boolean);
            if (serviceIds.length > 0) {
                query = query.where('jobs.serviceId', 'in', serviceIds);
            }
        } else if (filters.serviceId) {
            query = query.where('jobs.serviceId', '=', filters.serviceId);
        }

        const jobs = await query.orderBy('jobs.createdAt', 'desc').execute();

        // If currentFreelancerId is provided, check which jobs they've already applied to
        let appliedJobIds: Set<string> = new Set();
        if (filters.currentFreelancerId && jobs.length > 0) {
            const jobIds = jobs.map(j => j.id);
            const applications = await db
                .selectFrom('chatThreads')
                .select(['jobId', 'status'])
                .where('freelancerId', '=', filters.currentFreelancerId)
                .where('jobId', 'in', jobIds)
                .execute();

            for (const app of applications) {
                appliedJobIds.add(app.jobId);
            }
        }

        // Add hasApplied flag to each job
        const jobsWithApplicationStatus = jobs.map(job => ({
            ...job,
            hasApplied: appliedJobIds.has(job.id),
        }));

        const categorized = await categorizeJobsByPriority(jobsWithApplicationStatus, filters.serviceId || null);

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
