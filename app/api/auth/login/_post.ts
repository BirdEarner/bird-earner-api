import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { generateToken } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const loginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, loginSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { email, password } = validation.data;

        const user = await db
            .selectFrom('users')
            .selectAll()
            .where('email', '=', email)
            .executeTakeFirst();

        if (!user || !(await bcrypt.compare(password, user.password))) {
            return NextResponse.json({ success: false, message: 'Invalid email or password' }, { status: 401 });
        }

        // Detect role
        const freelancerProfile = await db.selectFrom('freelancers').select('id').where('userId', '=', user.id).executeTakeFirst();
        const clientProfile = await db.selectFrom('clients').select('id').where('userId', '=', user.id).executeTakeFirst();

        const role = freelancerProfile ? 'freelancer' : (clientProfile ? 'client' : 'USER');

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
    } catch (error) {
        console.error('Login error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
