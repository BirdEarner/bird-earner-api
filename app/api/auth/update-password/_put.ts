import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { getUserIdFromRequest } from '@/lib/auth';

const updatePasswordSchema = z.object({
    currentPassword: z.string(),
    newPassword: z.string().min(6),
});

export async function PUT(request: Request) {
    try {
        const userId = await getUserIdFromRequest(request);
        if (!userId) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = validateBody(body, updatePasswordSchema);

        if (!validation.success) {
            return NextResponse.json({
                success: false,
                message: validation.error
            }, { status: 400 });
        }

        const { currentPassword, newPassword } = validation.data;

        // Find user
        const user = await db
            .selectFrom('users')
            .selectAll()
            .where('id', '=', userId)
            .executeTakeFirst();

        if (!user) {
            return NextResponse.json({
                success: false,
                message: 'User not found'
            }, { status: 404 });
        }

        // Verify current password
        const isValidPassword = await bcrypt.compare(currentPassword, user.password);
        if (!isValidPassword) {
            return NextResponse.json({
                success: false,
                message: 'Current password is incorrect'
            }, { status: 400 });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password
        await db
            .updateTable('users')
            .set({
                password: hashedPassword,
                updatedAt: new Date(),
            })
            .where('id', '=', userId)
            .execute();

        return NextResponse.json({
            success: true,
            message: 'Password updated successfully'
        });

    } catch (error: any) {
        console.error('Update password error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
