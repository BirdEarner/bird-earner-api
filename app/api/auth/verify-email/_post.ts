import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const verifyOtpSchema = z.object({
    email: z.string().email(),
    otp: z.string().length(6),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, verifyOtpSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { email, otp } = validation.data;
        const emailLower = email.toLowerCase();

        const otpRecord = await db.selectFrom('otpVerifications')
            .select(['id', 'code', 'expiresAt', 'verified'])
            .where('email', '=', emailLower)
            .executeTakeFirst();

        if (!otpRecord) {
            return NextResponse.json({ success: false, message: 'No OTP found for this email' }, { status: 400 });
        }

        if (otpRecord.verified) {
            return NextResponse.json({ success: false, message: 'Email already verified' }, { status: 400 });
        }

        const now = new Date();
        if (new Date(otpRecord.expiresAt) <= now) {
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
            .where('email', '=', emailLower)
            .execute();

        return NextResponse.json({ success: true, message: 'Email verified successfully' });

    } catch (error) {
        console.error('Verify email OTP error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}