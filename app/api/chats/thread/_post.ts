import { getAuthUser } from '@/lib/auth';
import { createOrGetThread } from '@/lib/services/chats';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const threadSchema = z.object({
    jobId: z.string(),
    freelancerId: z.string(),
    clientId: z.string(),
});

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), threadSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const thread = await createOrGetThread(
            validation.data.jobId,
            validation.data.freelancerId,
            validation.data.clientId
        );

        return NextResponse.json({
            success: true,
            data: {
                ...thread,
                storageLimit: thread.storageLimit?.toString(),
                usedStorage: thread.usedStorage?.toString(),
            }
        });
    } catch (error: any) {
        console.error('Thread creation error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
