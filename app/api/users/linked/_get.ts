import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const { id: userId, role } = user;
        let linkedUsers: any[] = [];

        if (role === 'client') {
            const client = await db
                .selectFrom('clients')
                .select(['id'])
                .where('userId', '=', userId)
                .executeTakeFirst();

            if (!client) {
                return NextResponse.json({ success: false, message: 'Client profile not found' }, { status: 404 });
            }

            // Fetch freelancers assigned to this client's jobs
            const jobs = await db
                .selectFrom('jobs')
                .innerJoin('freelancers', 'jobs.assignedFreelancerId', 'freelancers.id')
                .innerJoin('users', 'freelancers.userId', 'users.id')
                .select([
                    'freelancers.id',
                    'freelancers.profilePhoto',
                    'users.fullName',
                    'users.email',
                    'jobs.id as jobId',
                    'jobs.jobTitle',
                    'jobs.jobStatus',
                    'jobs.createdAt'
                ])
                .where('jobs.clientId', '=', client.id)
                .where('jobs.assignedFreelancerId', 'is not', null)
                .execute();

            linkedUsers = jobs.map(job => ({
                id: job.id, // Freelancer ID
                title: job.jobTitle, // Job Title as "title"
                status: job.jobStatus === 'OPEN' || job.jobStatus === 'IN_PROGRESS' ? 'active' : 'inactive',
                created_at: job.createdAt,
                user: {
                    $id: job.id, // Using ID as $id for compatibility
                    full_name: job.fullName,
                    email: job.email,
                    profile_photo: job.profilePhoto
                },
                // For file upload dialog
                jobId: job.jobId,
                freelancerId: job.id
            }));

        } else if (role === 'freelancer') {
            const freelancer = await db
                .selectFrom('freelancers')
                .select(['id'])
                .where('userId', '=', userId)
                .executeTakeFirst();

            if (!freelancer) {
                return NextResponse.json({ success: false, message: 'Freelancer profile not found' }, { status: 404 });
            }

            // Fetch clients who have assigned this freelancer
            const jobs = await db
                .selectFrom('jobs')
                .innerJoin('clients', 'jobs.clientId', 'clients.id')
                .innerJoin('users', 'clients.userId', 'users.id')
                .select([
                    'clients.id',
                    'clients.profilePhoto',
                    'clients.companyName',
                    'users.fullName',
                    'users.email',
                    'jobs.id as jobId',
                    'jobs.jobTitle',
                    'jobs.jobStatus',
                    'jobs.createdAt'
                ])
                .where('jobs.assignedFreelancerId', '=', freelancer.id)
                .where('jobs.jobStatus', 'not in', ['COMPLETED', 'CANCELLED'])
                .execute();

            linkedUsers = jobs.map(job => ({
                id: job.id, // Client ID
                title: job.jobTitle,
                status: 'active',
                created_at: job.createdAt,
                user: {
                    $id: job.id,
                    full_name: job.companyName || job.fullName, // Use company name if available
                    email: job.email,
                    profile_photo: job.profilePhoto
                },
                jobId: job.jobId,
                clientId: job.id
            }));
        }

        return NextResponse.json({
            success: true,
            data: linkedUsers
        });

    } catch (error: any) {
        console.error('Error fetching linked users:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Failed to fetch linked users'
        }, { status: 500 });
    }
}
