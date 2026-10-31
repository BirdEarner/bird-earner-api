import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';
import { validateBody } from '@/lib/validation';
import { z } from 'zod';

const attachMobileSchema = z.object({
    mobile: z.string().min(10).max(15),
    otp: z.string().length(6),
});

export async function POST(request: Request) {
    try {
        const userId = await getUserIdFromRequest(request);
        if (!userId) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = validateBody(body, attachMobileSchema);
        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const mobile = validation.data.mobile.replace(/[\s\-\+\(\)]/g, '');
        const { otp } = validation.data;

        if (!/^\d{10,15}$/.test(mobile)) {
            return NextResponse.json(
                { success: false, message: 'Please enter a valid 10 to 15 digit mobile number' },
                { status: 400 }
            );
        }

        const currentUser = await db
            .selectFrom('users')
            .selectAll()
            .where('id', '=', userId)
            .executeTakeFirst();

        if (!currentUser) {
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
        }

        if (currentUser.mobile) {
            return NextResponse.json(
                { success: false, message: 'A mobile number is already linked to this account' },
                { status: 400 }
            );
        }

        const otpRecord = await db
            .selectFrom('otpVerifications')
            .select(['id', 'code', 'expiresAt', 'verified'])
            .where('mobile', '=', mobile)
            .executeTakeFirst();

        if (!otpRecord) {
            return NextResponse.json(
                { success: false, message: 'No OTP found for this mobile number' },
                { status: 400 }
            );
        }

        const now = new Date();
        if (!otpRecord.expiresAt || new Date(otpRecord.expiresAt) <= now) {
            return NextResponse.json(
                { success: false, message: 'OTP has expired. Please request a new one.' },
                { status: 400 }
            );
        }

        if (otpRecord.code !== otp) {
            return NextResponse.json({ success: false, message: 'Invalid OTP' }, { status: 400 });
        }

        const mobileTaken = await db
            .selectFrom('users')
            .select('id')
            .where('mobile', '=', mobile)
            .executeTakeFirst();

        if (mobileTaken && mobileTaken.id !== userId) {
            return NextResponse.json(
                { success: false, message: 'This mobile number is already registered with another account.' },
                { status: 400 }
            );
        }

        const updatedUser = await db
            .updateTable('users')
            .set({ mobile, updatedAt: now })
            .where('id', '=', userId)
            .returningAll()
            .executeTakeFirstOrThrow();

        await db
            .updateTable('otpVerifications')
            .set({
                verified: true,
                code: null,
                expiresAt: null,
                updatedAt: now,
            })
            .where('mobile', '=', mobile)
            .execute();

        const { password: _, ...userWithoutPassword } = updatedUser;

        return NextResponse.json({
            success: true,
            message: 'Mobile number verified and linked successfully',
            data: userWithoutPassword,
        });
    } catch (error: any) {
        console.error('Attach mobile error:', error);
        if (error.code === '23505' || error.message?.includes('users_mobile_key')) {
            return NextResponse.json(
                { success: false, message: 'This mobile number is already registered with another account.' },
                { status: 400 }
            );
        }
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
