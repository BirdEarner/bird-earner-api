import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { generateToken } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const adminLoginSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, adminLoginSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { email, password } = validation.data;

        const admin = await db
            .selectFrom('admins')
            .selectAll()
            .where('email', '=', email)
            .executeTakeFirst();

        if (!admin || !(await bcrypt.compare(password, admin.password))) {
            return NextResponse.json({ message: 'Invalid credentials' }, { status: 400 });
        }

        // Update last login info
        await db.updateTable('admins')
            .set({
                lastLoginAt: new Date(),
                // IP address handling in Next.js
                lastLoginIp: request.headers.get('x-forwarded-for') || '0.0.0.0',
            })
            .where('id', '=', admin.id)
            .execute();

        const token = generateToken({
            id: admin.id,
            email: admin.email,
            role: admin.role as 'admin' | 'superadmin',
        });

        return NextResponse.json({
            token,
            role: admin.role,
            id: admin.id,
            name: admin.name,
            email: admin.email,
        });
    } catch (error) {
        console.error('Admin login error:', error);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}
