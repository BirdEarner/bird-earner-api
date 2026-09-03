import { NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import { db } from '@/lib/db';
import { generateToken } from '@/lib/auth';
import { validateBody } from '@/lib/validation';
import { z } from 'zod';

const GOOGLE_REDIRECT_URI = 'https://auth.expo.io/@birdearner/birdearner?returnUrl=' + encodeURIComponent('birdearner://google-auth');

const googleAuthSchema = z.object({
    idToken: z.string().min(1, 'Google ID token is required').optional(),
    code: z.string().min(1, 'Google authorization code is required').optional(),
}).refine((data) => data.idToken || data.code, {
    message: 'Either idToken or code is required',
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, googleAuthSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { idToken, code } = validation.data;

        let googleEmail: string;
        let googleId: string;
        let fullName: string;
        let profilePhoto: string | null;
        let emailVerified: boolean;

        if (code) {
            const oauth2Client = new OAuth2Client(
                process.env.GOOGLE_CLIENT_ID,
                process.env.GOOGLE_CLIENT_SECRET,
                GOOGLE_REDIRECT_URI,
            );
            const { tokens } = await oauth2Client.getToken(code);
            if (!tokens.id_token) {
                return NextResponse.json({ success: false, message: 'Failed to get ID token from Google' }, { status: 401 });
            }
            const ticket = await oauth2Client.verifyIdToken({
                idToken: tokens.id_token,
                audience: process.env.GOOGLE_CLIENT_ID,
            });
            const payload = ticket.getPayload();
            if (!payload || !payload.email) {
                return NextResponse.json({ success: false, message: 'Invalid Google token' }, { status: 401 });
            }
            googleEmail = payload.email.toLowerCase();
            googleId = payload.sub;
            fullName = payload.name || '';
            profilePhoto = payload.picture || null;
            emailVerified = payload.email_verified || false;
        } else {
            const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
            const ticket = await client.verifyIdToken({
                idToken: idToken!,
                audience: process.env.GOOGLE_CLIENT_ID,
            });
            const payload = ticket.getPayload();
            if (!payload || !payload.email) {
                return NextResponse.json({ success: false, message: 'Invalid Google token' }, { status: 401 });
            }
            googleEmail = payload.email.toLowerCase();
            googleId = payload.sub;
            fullName = payload.name || '';
            profilePhoto = payload.picture || null;
            emailVerified = payload.email_verified || false;
        }

        let existingUser = await db
            .selectFrom('users')
            .selectAll()
            .where('email', '=', googleEmail)
            .executeTakeFirst();

        let isNewUser = false;

        if (existingUser) {
            if (existingUser.provider === 'email' && !existingUser.providerAccountId) {
                await db
                    .updateTable('users')
                    .set({
                        providerAccountId: googleId,
                        isEmailVerified: emailVerified ? true : existingUser.isEmailVerified,
                        updatedAt: new Date(),
                    })
                    .where('id', '=', existingUser.id)
                    .execute();
            }
        } else {
            isNewUser = true;
            const userId = crypto.randomUUID();
            const result = await db
                .insertInto('users')
                .values({
                    id: userId,
                    email: googleEmail,
                    password: null,
                    fullName: fullName,
                    provider: 'google',
                    providerAccountId: googleId,
                    isEmailVerified: emailVerified,
                    updatedAt: new Date(),
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            existingUser = result;
        }

        const freelancerProfile = await db
            .selectFrom('freelancers')
            .select('id')
            .where('userId', '=', existingUser.id)
            .executeTakeFirst();

        const clientProfile = await db
            .selectFrom('clients')
            .select('id')
            .where('userId', '=', existingUser.id)
            .executeTakeFirst();

        const role = freelancerProfile
            ? 'FREELANCER'
            : clientProfile
            ? 'CLIENT'
            : 'USER';

        const token = generateToken({
            id: existingUser.id,
            email: existingUser.email,
            role,
        });

        const { password: _, ...userWithoutPassword } = existingUser;

        const fullFreelancerProfile = await db
            .selectFrom('freelancers')
            .selectAll()
            .where('userId', '=', existingUser.id)
            .executeTakeFirst();

        const fullClientProfile = await db
            .selectFrom('clients')
            .selectAll()
            .where('userId', '=', existingUser.id)
            .executeTakeFirst();

        return NextResponse.json({
            success: true,
            message: isNewUser ? 'Google signup successful' : 'Google login successful',
            data: {
                ...userWithoutPassword,
                role,
                isNewUser,
                ...(fullFreelancerProfile ? { freelancer: fullFreelancerProfile } : {}),
                ...(fullClientProfile ? { client: fullClientProfile } : {}),
                token,
            },
        });
    } catch (error) {
        console.error('Google auth error:', error);
        return NextResponse.json({ success: false, message: 'Google authentication failed' }, { status: 500 });
    }
}
