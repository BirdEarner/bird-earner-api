import { db } from '@/lib/db';
import { generateToken } from '@/lib/auth';

type OAuthProvider = 'google' | 'apple';

type UpsertOAuthUserInput = {
    provider: OAuthProvider;
    providerAccountId: string;
    email: string | null;
    fullName?: string | null;
    profilePhoto?: string | null;
    emailVerified?: boolean;
};

/**
 * Find or create a user for Google/Apple sign-in.
 * Looks up by providerAccountId first (stable across Apple "Hide My Email"),
 * then by email. Email is required when creating a brand-new account.
 */
export async function upsertOAuthUser(input: UpsertOAuthUserInput) {
    const email = input.email?.toLowerCase() || null;
    let isNewUser = false;

    let existingUser = await db
        .selectFrom('users')
        .selectAll()
        .where('providerAccountId', '=', input.providerAccountId)
        .executeTakeFirst();

    if (!existingUser && email) {
        existingUser = await db
            .selectFrom('users')
            .selectAll()
            .where('email', '=', email)
            .executeTakeFirst();
    }

    if (existingUser) {
        const updates: Record<string, unknown> = { updatedAt: new Date() };

        if (!existingUser.providerAccountId) {
            updates.providerAccountId = input.providerAccountId;
        }
        if (existingUser.provider === 'email') {
            updates.provider = input.provider;
        }
        if (input.emailVerified && !existingUser.isEmailVerified) {
            updates.isEmailVerified = true;
        }
        if (input.fullName && !existingUser.fullName) {
            updates.fullName = input.fullName;
        }
        if (input.profilePhoto && !existingUser.profilePhoto) {
            updates.profilePhoto = input.profilePhoto;
        }

        if (Object.keys(updates).length > 1) {
            await db
                .updateTable('users')
                .set(updates)
                .where('id', '=', existingUser.id)
                .execute();

            existingUser = await db
                .selectFrom('users')
                .selectAll()
                .where('id', '=', existingUser.id)
                .executeTakeFirstOrThrow();
        }
    } else {
        if (!email) {
            return {
                error: 'Email is required to create an account. Please share your email with Sign in with Apple and try again.',
                status: 400 as const,
            };
        }

        isNewUser = true;
        const userId = crypto.randomUUID();
        existingUser = await db
            .insertInto('users')
            .values({
                id: userId,
                email,
                password: null,
                fullName: input.fullName || null,
                profilePhoto: input.profilePhoto || null,
                provider: input.provider,
                providerAccountId: input.providerAccountId,
                isEmailVerified: !!input.emailVerified,
                updatedAt: new Date(),
            })
            .returningAll()
            .executeTakeFirstOrThrow();
    }

    const freelancerProfile = await db
        .selectFrom('freelancers')
        .selectAll()
        .where('userId', '=', existingUser.id)
        .executeTakeFirst();

    const clientProfile = await db
        .selectFrom('clients')
        .selectAll()
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

    return {
        data: {
            ...userWithoutPassword,
            role,
            isNewUser,
            ...(freelancerProfile ? { freelancer: freelancerProfile } : {}),
            ...(clientProfile ? { client: clientProfile } : {}),
            token,
        },
        isNewUser,
        provider: input.provider,
    };
}
