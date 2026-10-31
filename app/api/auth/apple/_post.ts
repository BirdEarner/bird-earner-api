import { NextResponse } from 'next/server';
import { validateBody } from '@/lib/validation';
import { verifyAppleIdentityToken, isAppleEmailVerified } from '@/lib/apple-auth';
import { upsertOAuthUser } from '@/lib/oauth-user';
import { z } from 'zod';

const appleAuthSchema = z.object({
    identityToken: z.string().min(1, 'Apple identity token is required'),
    fullName: z.string().optional().nullable(),
    email: z.string().email().optional().nullable(),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, appleAuthSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { identityToken, fullName, email: clientEmail } = validation.data;

        let claims;
        try {
            claims = await verifyAppleIdentityToken(identityToken);
        } catch (err) {
            console.error('Apple token verification failed:', err);
            return NextResponse.json(
                { success: false, message: 'Invalid Apple identity token' },
                { status: 401 }
            );
        }

        // Email is only sent by Apple on the first authorization; client may also pass it.
        const email = claims.email || clientEmail || null;

        const result = await upsertOAuthUser({
            provider: 'apple',
            providerAccountId: claims.sub,
            email,
            fullName: fullName || null,
            emailVerified: isAppleEmailVerified(claims.email_verified) || !!claims.email || !!clientEmail,
        });

        if ('error' in result) {
            return NextResponse.json(
                { success: false, message: result.error },
                { status: result.status }
            );
        }

        return NextResponse.json({
            success: true,
            message: result.isNewUser ? 'Apple signup successful' : 'Apple login successful',
            data: result.data,
        });
    } catch (error) {
        console.error('Apple auth error:', error);
        return NextResponse.json(
            { success: false, message: 'Apple authentication failed' },
            { status: 500 }
        );
    }
}
