import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { buildLoginResponse } from '@/lib/session';
import { issueTwoFactorChallenge } from '@/lib/two-factor';
import { isKnownUserDevice, recordUserDevice } from '@/lib/user-devices';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    // Optional so existing clients keep working; devices without an id are not tracked
    deviceId: z.string().min(1).max(255).optional(),
    deviceName: z.string().max(255).optional(),
    platform: z.string().max(50).optional(),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, loginSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { email, password, deviceId, deviceName, platform } = validation.data;
        const device = { deviceId, deviceName, platform };

        const user = await db
            .selectFrom('users')
            .selectAll()
            .where('email', '=', email)
            .executeTakeFirst();

        if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
            return NextResponse.json({ success: false, message: 'Invalid email or password' }, { status: 401 });
        }

        // Accounts with two-factor on need a code when signing in from a device they haven't verified before
        const deviceIsKnown = deviceId ? await isKnownUserDevice(user.id, deviceId) : false;

        if (user.twoFactorEnabled && !deviceIsKnown) {
            if (!user.mobile) {
                return NextResponse.json(
                    { success: false, message: 'Two-factor authentication requires a mobile number on your account' },
                    { status: 400 }
                );
            }

            const { challengeId, maskedMobile } = await issueTwoFactorChallenge({
                userId: user.id,
                mobile: user.mobile,
                purpose: 'login',
                device,
            });

            return NextResponse.json({
                success: true,
                requiresTwoFactor: true,
                message: 'Enter the verification code sent to your mobile number',
                data: { challengeId, maskedMobile },
            });
        }

        await recordUserDevice(user.id, device);

        return buildLoginResponse(user);
    } catch (error) {
        console.error('Login error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
