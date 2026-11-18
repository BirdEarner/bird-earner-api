import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { buildLoginResponse } from '@/lib/session';
import { issueTwoFactorChallenge } from '@/lib/two-factor';
import { isKnownUserDevice, recordUserDevice } from '@/lib/user-devices';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const loginSchema = z.object({
    // Identifier is an email address or a mobile number (the login screen accepts both)
    email: z.string().min(3).max(255),
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
        const identifier = email.trim();

        let user = await db
            .selectFrom('users')
            .selectAll()
            .where('email', '=', identifier)
            .executeTakeFirst();

        // No email match, so the identifier may be the account's mobile number.
        // Signup requires a mobile, and stored mobiles are plain 10-15 digits, so accept
        // the forms a person can type (spaces/dashes/brackets, +91 or leading 0) and
        // match them onto that stored value. Emails are never treated as mobile input.
        const digits = identifier.replace(/\D/g, '');
        const isMobileInput = /^[\d\s\-+()]+$/.test(identifier) && digits.length >= 10 && digits.length <= 15;

        if (!user && isMobileInput) {
            let base = digits;
            if (base.startsWith('91') || base.startsWith('00')) base = base.slice(2);
            if (base.length > 10 && base.startsWith('0')) base = base.slice(1);

            const mobileCandidates = [...new Set([
                digits,
                base,
                base.length === 10 ? `91${base}` : '',
                base.length === 10 ? `0${base}` : '',
            ])].filter((c) => c.length >= 10 && c.length <= 15);

            if (mobileCandidates.length > 0) {
                user = await db
                    .selectFrom('users')
                    .selectAll()
                    .where('mobile', 'in', mobileCandidates)
                    .executeTakeFirst();
            }
        }

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

        return buildLoginResponse(user, deviceId);
    } catch (error) {
        console.error('Login error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
