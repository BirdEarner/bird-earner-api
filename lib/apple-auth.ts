import { createRemoteJWKSet, jwtVerify } from 'jose';

const APPLE_ISSUER = 'https://appleid.apple.com';
const APPLE_JWKS = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

export type AppleIdentityClaims = {
    sub: string;
    email?: string;
    email_verified?: boolean | string;
};

/**
 * Verify a Sign in with Apple identity token (JWT) against Apple's JWKS.
 * Audience must be the iOS bundle id (and optionally the Services ID).
 */
export async function verifyAppleIdentityToken(identityToken: string): Promise<AppleIdentityClaims> {
    const audiences = [
        process.env.APPLE_CLIENT_ID,
        process.env.APPLE_BUNDLE_ID,
        'com.birdearner.birdearner',
    ].filter(Boolean) as string[];

    const { payload } = await jwtVerify(identityToken, APPLE_JWKS, {
        issuer: APPLE_ISSUER,
        audience: audiences.length === 1 ? audiences[0] : audiences,
    });

    if (!payload.sub || typeof payload.sub !== 'string') {
        throw new Error('Apple identity token missing subject');
    }

    return {
        sub: payload.sub,
        email: typeof payload.email === 'string' ? payload.email : undefined,
        email_verified: payload.email_verified as boolean | string | undefined,
    };
}

export function isAppleEmailVerified(value: boolean | string | undefined): boolean {
    return value === true || value === 'true';
}
