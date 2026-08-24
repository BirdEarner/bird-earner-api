import { getAuthUser } from '@/lib/auth';
import { updatePhysicalJobProgress } from '@/lib/services/jobs';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const progressSchema = z.object({
    action: z.enum(['TRAVELLING', 'ARRIVED', 'REQUEST_OTP', 'VERIFY_OTP', 'CONFIRM_WORK_COMPLETED', 'EMERGENCY_CANCEL', 'RAISE_DISPUTE']),
    otpCode: z.string().optional(),
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
        const parsed = progressSchema.parse(body);

        const job = await updatePhysicalJobProgress(id, parsed.action, user.id, { otpCode: parsed.otpCode });

        return NextResponse.json({
            success: true,
            message: `Progress updated (${parsed.action}) successfully`,
            data: job,
        });
    } catch (error: any) {
        console.error('Job progress update error:', error);
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to update job progress' },
            { status: 500 }
        );
    }
}
