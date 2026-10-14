import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';
import { validateBody } from '@/lib/validation';
import { verifyTwoFactorChallenge } from '@/lib/two-factor';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const confirmSchema = z.object({
    challengeId: z.string().uuid(),
    code: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
});

// Applies a verified enable/disable request. Turning it on trusts the device that confirmed it.
export async function POST(request: Request) {
    try {
        const userId = await getUserIdFromRequest();
        if (!userId) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = validateBody(body, confirmSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { challengeId, code } = validation.data;

        const result = await verifyTwoFactorChallenge(challengeId, code, ['enable', 'disable'], userId);
        if (!result.ok) {
            return NextResponse.json({ success: false, message: result.message }, { status: result.status });
        }

        const enabled = result.challenge.purpose === 'enable';

        await db
            .updateTable('users')
            .set({ twoFactorEnabled: enabled, updatedAt: new Date() })
            .where('id', '=', userId)
            .execute();

        return NextResponse.json({
            success: true,
            message: enabled ? 'Two-factor authentication turned on' : 'Two-factor authentication turned off',
            data: { enabled },
        });
    } catch (error) {
        console.error('Confirm two-factor error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
