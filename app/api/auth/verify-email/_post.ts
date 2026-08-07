import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const verifyOtpSchema = z.object({
    mobile: z.string().min(10).max(15),
    otp: z.string().length(6),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, verifyOtpSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { mobile, otp } = validation.data;

        const otpRecord = await db.selectFrom('otpVerifications')
            .select(['id', 'code', 'expiresAt', 'verified'])
            .where('mobile', '=', mobile)
            .executeTakeFirst();

        if (!otpRecord) {
            return NextResponse.json({ success: false, message: 'No OTP found for this mobile number' }, { status: 400 });
        }

        if (otpRecord.verified) {
            return NextResponse.json({ success: false, message: 'Mobile number already verified' }, { status: 400 });
        }

        const now = new Date();
        if (!otpRecord.expiresAt || new Date(otpRecord.expiresAt) <= now) {
            return NextResponse.json({ success: false, message: 'OTP has expired. Please request a new one.' }, { status: 400 });
        }

        if (otpRecord.code !== otp) {
            return NextResponse.json({ success: false, message: 'Invalid OTP' }, { status: 400 });
        }

        await db.updateTable('otpVerifications')
            .set({
                verified: true,
                code: null,
                expiresAt: null,
                updatedAt: now,
            })
            .where('mobile', '=', mobile)
            .execute();

        return NextResponse.json({ success: true, message: 'Mobile number verified successfully' });

    } catch (error) {
        console.error('Verify mobile OTP error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
