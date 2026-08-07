import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';
import { sendEmailVerificationLink } from '@/lib/services/email';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
    try {
        const userId = await getUserIdFromRequest();
        if (!userId) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const user = await db.selectFrom('users')
            .select(['id', 'email', 'isEmailVerified'])
            .where('id', '=', userId)
            .executeTakeFirst();

        if (!user) {
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
        }

        if (user.isEmailVerified) {
            return NextResponse.json({ success: true, message: 'Email is already verified' });
        }

        const emailVerificationToken = crypto.randomUUID();
        const emailVerificationExpires = String(Date.now() + 5 * 24 * 60 * 60 * 1000);

        await db.updateTable('users')
            .set({
                emailVerificationToken: emailVerificationToken,
                emailVerificationExpires: emailVerificationExpires,
                updatedAt: new Date(),
            })
            .where('id', '=', userId)
            .execute();

        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const verificationUrl = `${baseUrl}/verify-email?token=${emailVerificationToken}`;
        await sendEmailVerificationLink(user.email, verificationUrl);

        return NextResponse.json({ success: true, message: 'Verification email sent successfully' });

    } catch (error) {
        console.error('Resend email verification error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
