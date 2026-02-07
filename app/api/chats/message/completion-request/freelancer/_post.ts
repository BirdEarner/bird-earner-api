import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const requestSchema = z.object({
    threadId: z.string(),
    jobId: z.string(),
});

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), requestSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { threadId, jobId } = validation.data;

        const requestMessage = await db.transaction().execute(async (trx) => {
            const job = await trx
                .selectFrom('jobs')
                .innerJoin('clients', 'clients.id', 'jobs.clientId')
                .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
                .select([
                    'jobs.id',
                    'jobs.paymentMethod',
                    'jobs.budgetAmount',
                    'clients.userId as clientUserId',
                    'freelancers.userId as freelancerUserId'
                ])
                .where('jobs.id', '=', jobId)
                .executeTakeFirst();

            if (!job) throw new Error('Job not found');
            if (job.freelancerUserId !== user.id) throw new Error('You are not assigned to this job');

            // Close existing requests
            await trx
                .updateTable('messages')
                .set({
                    messageData: sql`jsonb_set(message_data::jsonb, '{status}', '"closed"'::jsonb)::text`,
                    updatedAt: new Date()
                } as any)
                .where('chatThreadId', '=', threadId)
                .where('messageType', '=', 'completion_request')
                .execute();

            return await trx
                .insertInto('messages')
                .values({
                    id: crypto.randomUUID(),
                    chatThreadId: threadId,
                    senderId: user.id,
                    receiverId: job.clientUserId,
                    messageContent: 'Freelancer has requested project completion confirmation',
                    messageType: 'completion_request',
                    senderType: 'FREELANCER',
                    messageData: JSON.stringify({
                        requestedBy: 'freelancer',
                        jobId: jobId,
                        status: 'pending',
                        paymentMethod: job.paymentMethod,
                        budgetAmount: job.budgetAmount.toString()
                    }),
                    updatedAt: new Date()
                })
                .returningAll()
                .executeTakeFirstOrThrow();
        });

        return NextResponse.json({
            success: true,
            message: 'Completion request sent to client',
            data: requestMessage
        });
    } catch (error: any) {
        console.error('Freelancer request error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}

import { sql } from 'kysely';
