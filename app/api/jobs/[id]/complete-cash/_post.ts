import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const completeCashSchema = z.object({
    userRole: z.string().optional(),
    threadId: z.string(),
    budgetAmount: z.union([z.number(), z.string()]).transform(v => parseFloat(v.toString())),
});

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), completeCashSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { userRole, threadId, budgetAmount } = validation.data;

        const job = await db
            .selectFrom('jobs')
            .innerJoin('clients', 'clients.id', 'jobs.clientId')
            .leftJoin('freelancers', 'freelancers.id', 'jobs.assignedFreelancerId')
            .select([
                'jobs.id',
                'jobs.paymentMethod',
                'clients.userId as clientUserId',
                'freelancers.userId as freelancerUserId'
            ])
            .where('jobs.id', '=', id)
            .executeTakeFirst();

        if (!job) {
            return NextResponse.json({ success: false, message: 'Job not found' }, { status: 404 });
        }

        if (job.paymentMethod !== 'CASH') {
            return NextResponse.json({ success: false, message: 'Only for cash payments' }, { status: 400 });
        }

        let receiverId;
        if (user.id === job.freelancerUserId) {
            receiverId = job.clientUserId;
        } else {
            receiverId = job.freelancerUserId;
        }

        if (!receiverId) {
            return NextResponse.json({ success: false, message: 'Receiver not found' }, { status: 400 });
        }

        const paymentMessage = await db
            .insertInto('messages')
            .values({
                id: crypto.randomUUID(),
                chatThreadId: threadId,
                senderId: user.id,
                receiverId: receiverId,
                messageContent: 'Project completion and cash payment required',
                messageType: 'cash_payment',
                senderType: userRole ? userRole.toUpperCase() : 'CLIENT',
                messageData: JSON.stringify({
                    amount: budgetAmount,
                    step: 'initial',
                    clientConfirmed: false,
                    freelancerConfirmed: false,
                    jobId: id
                }),
                updatedAt: new Date()
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        return NextResponse.json({
            success: true,
            message: 'Cash payment flow initiated',
            data: paymentMessage
        });
    } catch (error: any) {
        console.error('Complete cash error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
