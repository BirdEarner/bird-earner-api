import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';
import { maskMobile } from '@/lib/two-factor';
import { NextResponse } from 'next/server';

// Current two-factor state for the Security > Two-Factor Authentication page
export async function GET() {
    try {
        const userId = await getUserIdFromRequest();
        if (!userId) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const user = await db
            .selectFrom('users')
            .select(['mobile', 'twoFactorEnabled'])
            .where('id', '=', userId)
            .executeTakeFirst();

        if (!user) {
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            data: {
                enabled: user.twoFactorEnabled,
                hasMobile: !!user.mobile,
                maskedMobile: user.mobile ? maskMobile(user.mobile) : null,
            },
        });
    } catch (error) {
        console.error('Get two-factor status error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
