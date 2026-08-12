import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const historySchema = z.object({
    chatThreadId: z.string().optional(),
    jobId: z.string().optional(),
});

export async function GET(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const params = {
            chatThreadId: searchParams.get('chatThreadId') || undefined,
            jobId: searchParams.get('jobId') || undefined,
        };

        const validation = await validateParams(Promise.resolve(params), historySchema);
        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { chatThreadId, jobId } = validation.data;

        let query = db
            .selectFrom('negotiationHistory')
            .selectAll()
            .orderBy('createdAt', 'asc');

        if (chatThreadId) {
            query = query.where('chatThreadId', '=', chatThreadId);
        } else if (jobId) {
            query = query.where('jobId', '=', jobId);
        } else {
            return NextResponse.json({ success: false, message: 'chatThreadId or jobId required' }, { status: 400 });
        }

        const history = await query.execute();

        return NextResponse.json({
            success: true,
            data: history.map(h => ({
                ...h,
                amount: h.amount?.toString(),
                previousAmount: h.previousAmount?.toString(),
            })),
        });
    } catch (error: any) {
        console.error('Get negotiation history error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Failed to fetch negotiation history',
        }, { status: 500 });
    }
}
