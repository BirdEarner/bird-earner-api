import { createRouteHandler } from '../../core/route-handler';
import { db } from '../../../../database/kysely';
import { verifyAuth } from '../../middleware/verify-auth';
import { jsonResponse } from '../../utils/json-response';

export const GET = createRouteHandler(async (request) => {
    const auth = await verifyAuth(request);

    if (!auth.isAuthenticated || !auth.user) {
        return jsonResponse({ success: false, message: 'Unauthorized' }, 401);
    }

    const { user } = auth;

    // Only freelancers should access this to upload files to clients
    if (user.role !== 'freelancer' && !user.isFreelancer) {
        return jsonResponse({ success: false, message: 'Only freelancers can access this endpoint' }, 403);
    }

    // Fetch active jobs assigned to this freelancer
    // Active means not COMPLETED and not CANCELLED
    // And has an assigned freelancer (which is checked by where clause)
    try {
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
            .where('jobs.assignedFreelancerId', '=', user.freelancerId!)
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
            // Legacy support fields for frontend compatibility if needed
            job_created_by: job.clientId,
            user: {
                $id: job.clientId,
                full_name: job.companyName || job.clientName
            }
        }));

        return jsonResponse({
            success: true,
            data: formattedJobs
        });

    } catch (error) {
        console.error('Error fetching active jobs:', error);
        return jsonResponse({ success: false, message: 'Failed to fetch active jobs' }, 500);
    }
});
