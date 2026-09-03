import { NextResponse } from 'next/server';
import { OAuth2Client } from 'google-auth-library';
import { db } from '@/lib/db';
import { generateToken } from '@/lib/auth';
import { z } from 'zod';

const client = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
);

const verifySchema = z.object({
    idToken: z.string().min(1),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = verifySchema.safeParse(body);

        if (!validation.success) {
            return NextResponse.json(
                { success: false, message: 'ID token is required' },
                { status: 400 }
            );
        }

        const { idToken } = validation.data;

        const ticket = await client.verifyIdToken({
            idToken,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        if (!payload || !payload.email) {
            return NextResponse.json(
                { success: false, message: 'Could not verify Google account' },
                { status: 401 }
            );
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
            isNewUser,
            data: {
                ...userWithoutPassword,
                role,
                ...(fullFreelancerProfile ? { freelancer: fullFreelancerProfile } : {}),
                ...(fullClientProfile ? { client: fullClientProfile } : {}),
                token,
            },
        });
    } catch (error) {
        console.error('Google verify error:', error);
        return NextResponse.json(
            { success: false, message: 'Failed to verify Google token' },
            { status: 500 }
        );
    }
}
