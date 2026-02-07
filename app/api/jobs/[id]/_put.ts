import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const updateJobSchema = z.object({
    jobTitle: z.string().min(5).optional(),
    jobDescription: z.string().min(20).optional(),
    jobCategory: z.string().optional(),
    jobSubCategory: z.string().optional(),
    skillsRequired: z.array(z.string()).optional(),
    projectType: z.string().optional(),
    budgetType: z.string().optional(),
    budgetAmount: z.union([z.number(), z.string()]).transform(v => parseFloat(v.toString())).optional(),
    deadlineDate: z.string().optional(),
    location: z.string().optional(),
    isUrgent: z.boolean().optional(),
});

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;

        // Check ownership
        const jobExists = await db
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .select('clients.userId')
            .where('jobs.id', '=', id)
            .executeTakeFirst();

        if (!jobExists || jobExists.userId !== user.id) {
            return NextResponse.json({ message: 'Unauthorized or not found' }, { status: 401 });
        }

        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), updateJobSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const updateData = { ...validation.data, updatedAt: new Date() };

        const updatedJob = await db
            .updateTable('jobs')
            .set(updateData as any)
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirstOrThrow();

        return NextResponse.json({
            success: true,
            message: 'Job updated successfully',
            data: updatedJob
        });
    } catch (error: any) {
        console.error('Update job error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
