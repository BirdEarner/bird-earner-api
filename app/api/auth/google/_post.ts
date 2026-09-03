import { NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import { db } from '@/lib/db';
import { generateToken } from '@/lib/auth';
import { validateBody } from '@/lib/validation';
import { z } from 'zod';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const googleAuthSchema = z.object({
    idToken: z.string().min(1, 'Google ID token is required'),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, googleAuthSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { idToken } = validation.data;

        const ticket = await client.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        if (!payload || !payload.email) {
            return NextResponse.json({ success: false, message: 'Invalid Google token' }, { status: 401 });
        }

        const googleEmail = payload.email.toLowerCase();
        const googleId = payload.sub;
        const fullName = payload.name || '';
        const profilePhoto = payload.picture || null;
        const emailVerified = payload.email_verified || false;

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
