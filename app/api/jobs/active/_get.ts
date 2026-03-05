import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const user = await getAuthUser();

        if (!user) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        // Detect freelancer profile for this user
        const freelancer = await db
            .selectFrom('freelancers')
            .select('id')
            .where('userId', '=', user.id)
            .executeTakeFirst();

        if (!freelancer) {
            return NextResponse.json({ success: false, message: 'Only freelancers can access this endpoint' }, { status: 403 });
        }

        const freelancerId = freelancer.id;

        // Fetch active jobs assigned to this freelancer
        // Active means not COMPLETED and not CANCELLED
        const activeJobs = await db
            .selectFrom('jobs')
            .innerJoin('clients', 'jobs.clientId', 'clients.id')
            .innerJoin('users', 'clients.userId', 'users.id')
            .select([
                'jobs.id',
                'jobs.jobTitle',
                'jobs.jobStatus',
                'jobs.createdAt',
                'clients.id as clientId',
                'users.fullName as clientName',
                'users.email as clientEmail',
                'clients.organizationType',
                'clients.companyName'
            ])
            .where('jobs.assignedFreelancerId', '=', freelancerId)
            .where('jobs.jobStatus', 'not in', ['COMPLETED', 'CANCELLED'])
            .execute();

        const formattedJobs = activeJobs.map(job => ({
            id: job.id,
            title: job.jobTitle,
            status: job.jobStatus,
            createdAt: job.createdAt,
            client: {
                id: job.clientId,
                name: job.companyName || job.clientName,
                email: job.clientEmail,
                organizationType: job.organizationType
            },
            // Legacy support fields for frontend compatibility
            job_created_by: job.clientId,
            user: {
                $id: job.clientId,
                full_name: job.companyName || job.clientName
            }
        }));

        return NextResponse.json({
            success: true,
            data: formattedJobs
        });

    } catch (error) {
        console.error('Error fetching active jobs:', error);
        return NextResponse.json({ success: false, message: 'Failed to fetch active jobs' }, { status: 500 });
    }
}
