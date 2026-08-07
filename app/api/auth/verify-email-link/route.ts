import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const token = searchParams.get('token');

        if (!token) {
            return NextResponse.json({ success: false, message: 'Token is required' }, { status: 400 });
        }

        const user = await db.selectFrom('users')
            .select(['id', 'emailVerificationExpires', 'isEmailVerified'])
            .where('emailVerificationToken', '=', token)
            .executeTakeFirst();

        if (!user) {
            return NextResponse.json({ success: false, message: 'Invalid verification link' }, { status: 400 });
        }

        if (user.isEmailVerified) {
            return NextResponse.json({ success: true, message: 'Email already verified' });
        }

        const now = BigInt(Date.now());
        if (!user.emailVerificationExpires || now > BigInt(user.emailVerificationExpires)) {
            return NextResponse.json({ success: false, message: 'Verification link has expired. Please request a new one.' }, { status: 400 });
        }

        await db.updateTable('users')
            .set({
                isEmailVerified: true,
                updatedAt: new Date(),
            })
            .where('id', '=', user.id)
            .execute();

        return NextResponse.json({ success: true, message: 'Email verified successfully' });

    } catch (error) {
        console.error('Verify email link error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
