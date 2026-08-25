import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { createJob } from '@/lib/services/jobs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const createJobSchema = z.object({
    jobTitle: z
        .string()
        .trim()
        .min(5, 'Job title must be at least 5 characters'),
    jobDescription: z
        .string()
        .trim()
        .min(20, 'Job description must be at least 20 characters'),
    jobCategory: z.string().min(1, 'Job category is required'),
    jobSubCategory: z.string().min(1, 'Job subcategory is required'),
    skillsRequired: z.array(z.string().trim().min(1, 'Skills cannot be empty')).optional(),
    projectType: z.string().min(1, 'Project type is required'),
    budgetType: z.string().min(1, 'Budget type is required'),
    budgetAmount: z.union([z.number(), z.string()]).transform(v => parseFloat(v.toString())),
    serviceId: z.string().optional(),
    workDurationDays: z.number().int().min(1).max(3).optional().default(1),
    paymentMethod: z.enum(['PLATFORM', 'CASH']).optional(),
    attachedFiles: z.array(z.string()).optional(),
    location: z.string().optional(),
    latitude: z.union([z.number(), z.string()]).optional().transform(v => v != null ? parseFloat(v.toString()) : null),
    longitude: z.union([z.number(), z.string()]).optional().transform(v => v != null ? parseFloat(v.toString()) : null),
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
