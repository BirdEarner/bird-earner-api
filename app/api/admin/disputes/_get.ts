import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    try {
        const admin = await getAdminUser(request);
        if (!admin) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const status = searchParams.get('status');

        let query = db
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .innerJoin('users as clientUser', 'clientUser.id', 'clients.userId')
            .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
            .leftJoin('users as freelancerUser', 'freelancerUser.id', 'freelancers.userId')
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
                'jobs.paymentStatus',
                'jobs.paymentMethod',
                'jobs.location',
                'jobs.cancellationReason',
                'jobs.createdAt',
                'jobs.updatedAt',
                'clients.id as clientId',
                'clientUser.fullName as clientName',
                'clientUser.email as clientEmail',
                'clientUser.mobile as clientPhone',
                'freelancers.id as freelancerId',
                'freelancerUser.fullName as freelancerName',
                'freelancerUser.email as freelancerEmail',
                'freelancers.mobileNumber as freelancerPhone',
            ]);

        if (status) {
            query = query.where('jobs.jobStatus', '=', status as any);
        } else {
            query = query.where('jobs.jobStatus', 'in', ['DISPUTE_OPEN', 'DISPUTE_RESOLVED', 'REFUNDED']);
        }

        const jobs = await query.orderBy('jobs.updatedAt', 'desc').execute();

        // Fetch status histories for these jobs
        const jobIds = jobs.map((j) => j.id);

        let histories: any[] = [];
        if (jobIds.length > 0) {
            histories = await db
                .selectFrom('jobStatusHistory')
                .select(['id', 'jobId', 'status', 'changedBy', 'userType', 'action', 'reason', 'createdAt'])
                .where('jobId', 'in', jobIds)
                .orderBy('createdAt', 'asc')
                .execute();
        }

        const formattedDisputes = jobs.map((job) => {
            const historyList = histories.filter((h) => h.jobId === job.id);
            const raiseDisputeLog = historyList.find((h) => h.action === 'RAISE_DISPUTE' || h.status === 'DISPUTE_OPEN');

            return {
                id: job.id,
                title: job.jobTitle,
                description: job.jobDescription,
                category: job.jobCategory,
                subCategory: job.jobSubCategory,
                projectType: job.projectType,
                budgetAmount: parseFloat(job.budgetAmount?.toString() || '0'),
                jobStatus: job.jobStatus,
                paymentStatus: job.paymentStatus,
                paymentMethod: job.paymentMethod,
                location: job.location,
                cancellationReason: job.cancellationReason,
                disputeRaisedAt: raiseDisputeLog?.createdAt || job.updatedAt,
                disputeReason: raiseDisputeLog?.reason || 'Dispute raised by user',
                raisedBy: raiseDisputeLog?.userType || 'UNKNOWN',
                client: {
                    id: job.clientId,
                    name: job.clientName,
                    email: job.clientEmail,
                    phone: job.clientPhone,
                },
                freelancer: job.freelancerId ? {
                    id: job.freelancerId,
                    name: job.freelancerName,
                    email: job.freelancerEmail,
                    phone: job.freelancerPhone,
                } : null,
                history: historyList,
                createdAt: job.createdAt,
                updatedAt: job.updatedAt,
            };
        });

        return NextResponse.json({
            success: true,
            disputes: formattedDisputes,
        });
    } catch (error: any) {
        console.error('Fetch admin disputes error:', error);
        return NextResponse.json({ message: error.message || 'Server error' }, { status: 500 });
    }
}
