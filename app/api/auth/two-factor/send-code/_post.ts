import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';
import { validateBody } from '@/lib/validation';
import { issueTwoFactorChallenge } from '@/lib/two-factor';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const sendCodeSchema = z.object({
    purpose: z.enum(['enable', 'disable']),
    deviceId: z.string().min(1).max(255).optional(),
    deviceName: z.string().max(255).optional(),
    platform: z.string().max(50).optional(),
});

// Texts a confirmation code before two-factor authentication is turned on or off
export async function POST(request: Request) {
    try {
        const userId = await getUserIdFromRequest();
        if (!userId) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = validateBody(body, sendCodeSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { purpose, deviceId, deviceName, platform } = validation.data;

        const user = await db
            .selectFrom('users')
            .select(['mobile', 'twoFactorEnabled'])
            .where('id', '=', userId)
            .executeTakeFirst();

        if (!user) {
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
        }

        if (!user.mobile) {
            return NextResponse.json(
                { success: false, message: 'Add a mobile number to your account before turning on two-factor authentication' },
                { status: 400 }
            );
        }

        if (purpose === 'enable' && user.twoFactorEnabled) {
            return NextResponse.json({ success: false, message: 'Two-factor authentication is already on' }, { status: 400 });
        }

        if (purpose === 'disable' && !user.twoFactorEnabled) {
            return NextResponse.json({ success: false, message: 'Two-factor authentication is already off' }, { status: 400 });
        }

        const { challengeId, maskedMobile } = await issueTwoFactorChallenge({
            userId,
            mobile: user.mobile,
            purpose,
            device: { deviceId, deviceName, platform },
        });

        return NextResponse.json({
            success: true,
            message: 'Verification code sent',
            data: { challengeId, maskedMobile },
        });
    } catch (error) {
        console.error('Send two-factor code error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
