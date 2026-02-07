import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;

        const job = await db
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .innerJoin('users as clientUser', 'clientUser.id', 'clients.userId')
            .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
            .leftJoin('users as freeUser', 'freeUser.id', 'freelancers.userId')
            .leftJoin('services', 'services.id', 'jobs.serviceId')
            .select([
                'jobs.id',
                'jobs.jobTitle',
                'jobs.jobDescription',
                'jobs.jobCategory',
                'jobs.jobSubCategory',
                'jobs.budgetAmount',
                'jobs.budgetType',
                'jobs.deadlineDate',
                'jobs.jobStatus',
                'jobs.paymentMethod',
                'jobs.paymentStatus',
                'jobs.isAmountReserved',
                'jobs.isUrgent',
                'jobs.skillsRequired',
                'jobs.attachedFiles',
                'jobs.location',
                'jobs.createdAt',
                'clientUser.fullName as clientName',
                'clientUser.email as clientEmail',
                'clients.id as clientId',
                'freeUser.fullName as freelancerName',
                'freeUser.email as freelancerEmail',
                'freelancers.id as freelancerId',
                'services.name as serviceName'
            ])
            .where('jobs.id', '=', id)
            .executeTakeFirst();

        if (!job) {
            return NextResponse.json({ success: false, message: 'Job not found' }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            data: job
        });
    } catch (error) {
        console.error('Get job error:', error);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}
