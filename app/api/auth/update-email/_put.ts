import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';
import bcrypt from 'bcryptjs';

export async function PUT(request: Request) {
    try {
        const userId = await getUserIdFromRequest(request);
        if (!userId) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { newEmail, password } = await request.json();

        if (!newEmail || !password) {
            return NextResponse.json({
                success: false,
                message: 'New email and password are required'
            }, { status: 400 });
        }

        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(newEmail)) {
            return NextResponse.json({
                success: false,
                message: 'Invalid email format'
            }, { status: 400 });
        }

        // Get current user
        const currentUser = await db
            .selectFrom('users')
            .select(['id', 'email', 'password'])
            .where('id', '=', userId)
            .executeTakeFirst();

        if (!currentUser) {
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
        }

        if (currentUser.email === newEmail) {
            return NextResponse.json({
                success: false,
                message: 'New email must be different from current email'
            }, { status: 400 });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, currentUser.password);
        if (!isValidPassword) {
            return NextResponse.json({ success: false, message: 'Invalid password' }, { status: 400 });
        }

        // Check if email already exists
        const existingUser = await db
            .selectFrom('users')
            .select('id')
            .where('email', '=', newEmail)
            .executeTakeFirst();

        if (existingUser) {
            return NextResponse.json({
                success: false,
                message: 'Email already in use. Please try another.'
            }, { status: 400 });
        }

        // Update email
        await db
            .updateTable('users')
            .set({ email: newEmail, updatedAt: new Date() })
            .where('id', '=', userId)
            .execute();

        return NextResponse.json({
            success: true,
            message: 'Email updated successfully'
        });

    } catch (error: any) {
        console.error('Update email error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
