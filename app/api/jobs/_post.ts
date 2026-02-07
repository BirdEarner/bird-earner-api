import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { createJob } from '@/lib/services/jobs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const createJobSchema = z.object({
    jobTitle: z.string().min(5),
    jobDescription: z.string().min(20),
    jobCategory: z.string(),
    jobSubCategory: z.string(),
    skillsRequired: z.array(z.string()).optional(),
    projectType: z.string(),
    budgetType: z.string(),
    budgetAmount: z.union([z.number(), z.string()]).transform(v => parseFloat(v.toString())),
    serviceId: z.string().optional(),
    deadlineDate: z.string().optional(),
    paymentMethod: z.enum(['PLATFORM', 'CASH']).optional(),
    attachedFiles: z.array(z.string()).optional(),
    location: z.string().optional(),
    isUrgent: z.boolean().optional(),
});

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        // Get client profile
        const client = await db
            .selectFrom('clients')
            .select('id')
            .where('userId', '=', user.id)
            .executeTakeFirst();

        if (!client) {
            return NextResponse.json({ message: 'Client profile not found' }, { status: 400 });
        }

        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), createJobSchema);
        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const job = await createJob(validation.data, user.id, client.id);

        return NextResponse.json({
            success: true,
            message: 'Job created successfully',
            data: job
        }, { status: 201 });
    } catch (error: any) {
        console.error('Create job error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Failed to create job'
        }, { status: 500 });
    }
}
