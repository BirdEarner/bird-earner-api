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

        const { newMobile, password } = await request.json();

        if (!newMobile || !password) {
            return NextResponse.json({
                success: false,
                message: 'New mobile number and password are required'
            }, { status: 400 });
        }

        // Validate mobile format (10 to 15 digits)
        const mobileClean = newMobile.replace(/[\s\-\+\(\)]/g, '');
        if (!/^\d{10,15}$/.test(mobileClean)) {
            return NextResponse.json({
                success: false,
                message: 'Please enter a valid 10 to 15 digit mobile number'
            }, { status: 400 });
        }

        // Get current user
        const currentUser = await db
            .selectFrom('users')
            .select(['id', 'email', 'mobile', 'password'])
            .where('id', '=', userId)
            .executeTakeFirst();

        if (!currentUser) {
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
        }

        if (currentUser.mobile === mobileClean) {
            return NextResponse.json({
                success: false,
                message: 'New mobile number must be different from current mobile number'
            }, { status: 400 });
        }

        // Verify password
        if (!currentUser.password) {
            return NextResponse.json({
                success: false,
                message: 'No password set for this account'
            }, { status: 400 });
        }

        const isValidPassword = await bcrypt.compare(password, currentUser.password);
        if (!isValidPassword) {
            return NextResponse.json({
                success: false,
                message: 'Current password is incorrect. Please enter your correct password.'
            }, { status: 400 });
        }

        // Check if mobile number is already used by another user
        const existingUser = await db
            .selectFrom('users')
            .select('id')
            .where('mobile', '=', mobileClean)
            .where('id', '!=', userId)
            .executeTakeFirst();

        if (existingUser) {
            return NextResponse.json({
                success: false,
                message: 'This mobile number is already registered with another account.'
            }, { status: 400 });
        }

        // Update user mobile number
        await db
            .updateTable('users')
            .set({ mobile: mobileClean, updatedAt: new Date() })
            .where('id', '=', userId)
            .execute();

        return NextResponse.json({
            success: true,
            message: 'Mobile number updated successfully',
            mobile: mobileClean
        });

    } catch (error: any) {
        console.error('Update mobile error:', error);
        if (error.code === '23505' || error.message?.includes('users_mobile_key') || error.message?.includes('unique constraint')) {
            return NextResponse.json({
                success: false,
                message: 'This mobile number is already registered with another account.'
            }, { status: 400 });
        }
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
