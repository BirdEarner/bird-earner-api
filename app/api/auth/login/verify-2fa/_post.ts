import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { buildLoginResponse } from '@/lib/session';
import { verifyTwoFactorChallenge } from '@/lib/two-factor';
import { recordUserDevice } from '@/lib/user-devices';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const verifyLoginSchema = z.object({
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

// Completes a password login that was held back for a two-factor code
export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, verifyLoginSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { challengeId, code } = validation.data;

        const result = await verifyTwoFactorChallenge(challengeId, code, ['login']);
        if (!result.ok) {
            return NextResponse.json({ success: false, message: result.message }, { status: result.status });
        }

        const user = await db
            .selectFrom('users')
            .selectAll()
            .where('id', '=', result.challenge.userId)
            .executeTakeFirst();

        if (!user) {
            return NextResponse.json({ success: false, message: 'Invalid code. Please request a new one.' }, { status: 400 });
        }

        // The device that passed the code becomes a known device, so it won't be challenged again
        await recordUserDevice(user.id, {
            deviceId: result.challenge.deviceId ?? undefined,
            deviceName: result.challenge.deviceName ?? undefined,
            platform: result.challenge.platform ?? undefined,
        });

        return buildLoginResponse(user, result.challenge.deviceId ?? undefined);
    } catch (error) {
        console.error('Two-factor login error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
