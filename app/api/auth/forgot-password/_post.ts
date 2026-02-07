import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { z } from 'zod';
import crypto from 'crypto';
import { sendResetEmail } from '@/lib/services/email';

const forgotPasswordSchema = z.object({
    email: z.string().email(),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, forgotPasswordSchema);

        if (!validation.success) {
            return NextResponse.json({
                success: false,
                message: 'Invalid email address'
            }, { status: 400 });
        }

        const { email } = validation.data;

        // Find user
        const user = await db
            .selectFrom('users')
            .select(['id', 'email'])
            .where('email', '=', email)
            .executeTakeFirst();

        if (!user) {
            // For security, don't reveal if user doesn't exist
            // But legacy server returns 404. Let's stick to legacy for now or improve?
            // Legacy: if (!user) return res.status(404).json({ success: false, message: "No user found with this email" });
            return NextResponse.json({
                success: false,
                message: 'No user found with this email'
            }, { status: 404 });
        }

        // Generate token and expiry
        const token = crypto.randomBytes(32).toString('hex');
        const expires = String(Date.now() + 1000 * 60 * 30); // 30 min

        await db
            .updateTable('users')
            .set({
                resetPasswordToken: token,
                resetPasswordExpires: expires,
            })
            .where('id', '=', user.id)
            .execute();

        // Send email
        const resetUrl = `${process.env.FRONTEND_URL || 'https://app.birdearner.com'}/auth/reset-password/${token}`;

        try {
            await sendResetEmail(email, resetUrl);
        } catch (emailError) {
            console.error('Failed to send reset email:', emailError);
            // Still return success to user or notify error?
            // Legacy: res.json({ success: true, message: "Reset link sent" });
        }

        return NextResponse.json({
            success: true,
            message: 'Reset link sent'
        });

    } catch (error: any) {
        console.error('Forgot password error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
