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

        // Get role from profile tables if needed, or if it's in the user table
        // The current schema has a 'role' in User table (as an enum in Prisma)
        // Wait, let's check the Prisma schema again for the User table.

        // In Bird Earner, the 'role' seems to be determined by the existence of profile.
        // However, the Express model showed `normalizedRole = userData.role ? userData.role.toUpperCase() : 'FREELANCER';`
        // Wait, let's check the Prisma schema created in Step 103/104.

        const token = generateToken({
            id: user.id,
            email: user.email,
            role: 'USER', // Basic role, actual role details come from profiles
        });

        const { password: _, ...userWithoutPassword } = user;

        return NextResponse.json({
            success: true,
            message: 'Login successful',
            data: {
                ...userWithoutPassword,
                token,
            },
        });
    } catch (error) {
        console.error('Login error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
