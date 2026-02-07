import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const resetPasswordSchema = z.object({
    password: z.string().min(6),
});

export async function POST(
    request: Request,
    { params }: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await params;
        const body = await request.json();
        const validation = validateBody(body, resetPasswordSchema);

        if (!validation.success) {
            return NextResponse.json({
                success: false,
                message: 'Password must be at least 6 characters'
            }, { status: 400 });
        }

        const { password } = validation.data;

        // Find user by token and check expiry
        const user = await db
            .selectFrom('users')
            .selectAll()
            .where('resetPasswordToken', '=', token)
            .where('resetPasswordExpires', '>', BigInt(Date.now()))
            .executeTakeFirst();

        if (!user) {
            return NextResponse.json({
                success: false,
                message: 'Invalid or expired reset token'
            }, { status: 400 });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Update user and clear reset token
        await db
            .updateTable('users')
            .set({
                password: hashedPassword,
                resetPasswordToken: null,
                resetPasswordExpires: null,
            })
            .where('id', '=', user.id)
            .execute();

        return NextResponse.json({
            success: true,
            message: 'Password has been reset successfully'
        });

    } catch (error: any) {
        console.error('Reset password error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
