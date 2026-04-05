import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { sendVerificationEmail } from '@/lib/services/email';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const sendOtpSchema = z.object({
    email: z.string().email(),
});

function generateOtp(): string {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, sendOtpSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { email } = validation.data;
        const emailLower = email.toLowerCase();

        const existingOtp = await db.selectFrom('otpVerifications')
            .select(['id', 'code', 'expiresAt', 'verified'])
            .where('email', '=', emailLower)
            .executeTakeFirst();

        const now = new Date();

        if (existingOtp && !existingOtp.verified) {
            const isExpired = !existingOtp.expiresAt || new Date(existingOtp.expiresAt) <= now;
            
            if (!isExpired) {
                const otp = existingOtp.code;
                await sendVerificationEmail(emailLower, otp);
                return NextResponse.json({ success: true, message: 'OTP sent successfully' });
            } else {
                const newOtp = generateOtp();
                const expiresAt = new Date(now.getTime() + 20 * 60 * 1000);

                await db.updateTable('otpVerifications')
                    .set({
                        code: newOtp,
                        expiresAt: expiresAt,
                        updatedAt: now,
                    })
                    .where('email', '=', emailLower)
                    .execute();

                await sendVerificationEmail(emailLower, newOtp);
                return NextResponse.json({ success: true, message: 'OTP sent successfully' });
            }
        }

        const otp = generateOtp();
        const expiresAt = new Date(now.getTime() + 20 * 60 * 1000);

        if (existingOtp) {
            await db.updateTable('otpVerifications')
                .set({
                    code: otp,
                    expiresAt: expiresAt,
                    verified: false,
                    updatedAt: now,
                })
                .where('email', '=', emailLower)
                .execute();
        } else {
            await db.insertInto('otpVerifications')
                .values({
                    id: crypto.randomUUID(),
                    email: emailLower,
                    code: otp,
                    expiresAt: expiresAt,
                    verified: false,
                    createdAt: now,
                    updatedAt: now,
                })
                .execute();
        }

        await sendVerificationEmail(emailLower, otp);

        return NextResponse.json({ success: true, message: 'OTP sent successfully' });

    } catch (error) {
        console.error('Send verification OTP error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}