import { db } from '@/lib/db';
import { generateToken } from '@/lib/auth';
import { NextResponse } from 'next/server';
import type { Selectable } from 'kysely';
import type { User } from '@/types/types';

// Issues a JWT for the user and builds the login response (profiles + role + token cookie).
// Shared by password login and the two-factor verification step so both return the same shape.
export async function buildLoginResponse(user: Selectable<User>): Promise<NextResponse> {
    const freelancerProfile = await db.selectFrom('freelancers').select('id').where('userId', '=', user.id).executeTakeFirst();
    const clientProfile = await db.selectFrom('clients').select('id').where('userId', '=', user.id).executeTakeFirst();

    const role = freelancerProfile ? 'FREELANCER' : (clientProfile ? 'CLIENT' : 'USER');

    const token = generateToken({
        id: user.id,
        email: user.email,
        role,
    });

    const { password: _, ...userWithoutPassword } = user;

    // Fetch related profiles
    const fullFreelancerProfile = await db.selectFrom('freelancers').selectAll().where('userId', '=', user.id).executeTakeFirst();
    const fullClientProfile = await db.selectFrom('clients').selectAll().where('userId', '=', user.id).executeTakeFirst();

    const response = NextResponse.json({
        success: true,
        message: 'Login successful',
        data: {
            ...userWithoutPassword,
            role,
            ...(fullFreelancerProfile ? { freelancer: fullFreelancerProfile } : {}),
            ...(fullClientProfile ? { client: fullClientProfile } : {}),
            token,
        },
    });

    // Set the token in a cookie
    response.cookies.set({
        name: 'token',
        value: token,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24, // 24 hours
    });

    return response;
}
