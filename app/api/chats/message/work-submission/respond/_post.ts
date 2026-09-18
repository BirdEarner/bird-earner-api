import { getAuthUser } from '@/lib/auth';
import { respondToWorkSubmissionMessage } from '@/lib/services/chats';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const respondSchema = z.object({
    messageId: z.string(),
    decision: z.enum(['ACCEPT', 'REVISE_REQUESTED']),
    revisionNotes: z.string().optional(),
});

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), respondSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const result = await respondToWorkSubmissionMessage(
            validation.data.messageId,
            user.id,
            validation.data.decision,
            validation.data.revisionNotes
        );

        return NextResponse.json({
            success: true,
            data: result
        });
    } catch (error: any) {
        console.error('Work submission respond error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
