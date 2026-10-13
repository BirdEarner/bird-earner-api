import { getAuthUser } from '@/lib/auth';
import { updatePhysicalJobProgress } from '@/lib/services/jobs';
import { NextResponse } from 'next/server';
import { z } from 'zod';

/** Service messages that describe a refused action, not a server fault */
const EXPECTED_REFUSAL = /Invalid OTP|Too many invalid OTP|OTP code required|OTP can only|Choose a reason|reason is required|must be|must mark|only available|can only|not available|no longer|cannot|raise a dispute|has already|not found|Job not found/i;

const progressSchema = z.object({
    action: z.enum(['TRAVELLING', 'ARRIVED', 'REQUEST_OTP', 'VERIFY_OTP', 'CONFIRM_WORK_COMPLETED', 'EMERGENCY_CANCEL', 'RAISE_DISPUTE', 'CANCEL_SCOPE_MISMATCH']),
    otpCode: z.string().optional(),
    reason: z.string().optional(),
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

        const job = await updatePhysicalJobProgress(id, parsed.action, user.id, { otpCode: parsed.otpCode, reason: parsed.reason });

        return NextResponse.json({
            success: true,
            message: `Progress updated (${parsed.action}) successfully`,
            data: job,
        });
    } catch (error: any) {
        const message: string = error.message || 'Failed to update job progress';

        // Expected refusals from the service (wrong OTP, rule violations) are client errors, not server failures
        if (message.startsWith('Unauthorized')) {
            return NextResponse.json({ success: false, message }, { status: 403 });
        }
        if (EXPECTED_REFUSAL.test(message)) {
            return NextResponse.json({ success: false, message }, { status: 400 });
        }

        console.error('Job progress update error:', error);
        return NextResponse.json({ success: false, message }, { status: 500 });
    }
}
