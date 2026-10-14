import { db } from '@/lib/db';
import { sendSmsOtp } from '@/lib/services/sms';
import { randomInt } from 'crypto';
import bcrypt from 'bcryptjs';
import { sql } from 'kysely';

export type TwoFactorPurpose = 'login' | 'enable' | 'disable';

export interface DeviceInfo {
    deviceId?: string;
    deviceName?: string;
    platform?: string;
}

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;

export function maskMobile(mobile: string): string {
    return `******${mobile.slice(-4)}`;
}

// Creates a challenge for the user, stores only a hash of the code, and texts the code to their mobile.
export async function issueTwoFactorChallenge(params: {
    userId: string;
    mobile: string;
    purpose: TwoFactorPurpose;
    device: DeviceInfo;
}): Promise<{ challengeId: string; maskedMobile: string }> {
    const code = randomInt(100000, 1000000).toString();
    const codeHash = await bcrypt.hash(code, 10);

    const challenge = await db
        .insertInto('twoFactorChallenges')
        .values({
            id: crypto.randomUUID(),
            userId: params.userId,
            purpose: params.purpose,
            codeHash,
            deviceId: params.device.deviceId ?? null,
            deviceName: params.device.deviceName ?? null,
            platform: params.device.platform ?? null,
            expiresAt: new Date(Date.now() + CODE_TTL_MS),
        })
        .returning('id')
        .executeTakeFirstOrThrow();

    await sendSmsOtp(params.mobile, code);

    return { challengeId: challenge.id, maskedMobile: maskMobile(params.mobile) };
}

type VerifyFailure = { ok: false; status: number; message: string };
type VerifySuccess = {
    ok: true;
    challenge: {
        id: string;
        userId: string;
        purpose: string;
        deviceId: string | null;
        deviceName: string | null;
        platform: string | null;
    };
};

// Checks a code against its challenge. A successful check consumes the challenge so it can't be replayed.
// Pass userId when the caller is already authenticated so other users' challenges are rejected up front.
export async function verifyTwoFactorChallenge(
    challengeId: string,
    code: string,
    allowedPurposes: TwoFactorPurpose[],
    userId?: string
): Promise<VerifySuccess | VerifyFailure> {
    const challenge = await db
        .selectFrom('twoFactorChallenges')
        .selectAll()
        .where('id', '=', challengeId)
        .executeTakeFirst();

    if (
        !challenge ||
        !allowedPurposes.includes(challenge.purpose as TwoFactorPurpose) ||
        (userId !== undefined && challenge.userId !== userId)
    ) {
        return { ok: false, status: 400, message: 'Invalid code. Please request a new one.' };
    }
    if (challenge.consumedAt) {
        return { ok: false, status: 400, message: 'This code has already been used. Please request a new one.' };
    }
    if (new Date(challenge.expiresAt) <= new Date()) {
        return { ok: false, status: 400, message: 'This code has expired. Please request a new one.' };
    }
    if (challenge.attempts >= MAX_ATTEMPTS) {
        return { ok: false, status: 429, message: 'Too many incorrect attempts. Please request a new code.' };
    }

    // Count the attempt before comparing so parallel guesses can't get around the limit
    await db
        .updateTable('twoFactorChallenges')
        .set({ attempts: sql`attempts + 1` })
        .where('id', '=', challengeId)
        .execute();

    const matches = await bcrypt.compare(code, challenge.codeHash);
    if (!matches) {
        return { ok: false, status: 400, message: 'Incorrect code. Please try again.' };
    }

    const consumed = await db
        .updateTable('twoFactorChallenges')
        .set({ consumedAt: new Date() })
        .where('id', '=', challengeId)
        .where('consumedAt', 'is', null)
        .executeTakeFirst();

    if (Number(consumed.numUpdatedRows) === 0) {
        return { ok: false, status: 400, message: 'This code has already been used. Please request a new one.' };
    }

    return {
        ok: true,
        challenge: {
            id: challenge.id,
            userId: challenge.userId,
            purpose: challenge.purpose,
            deviceId: challenge.deviceId,
            deviceName: challenge.deviceName,
            platform: challenge.platform,
        },
    };
}
