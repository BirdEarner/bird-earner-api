import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { generateToken } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const adminSignupSchema = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(6),
    role: z.enum(['admin', 'superadmin']).optional().default('admin'),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, adminSignupSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { name, email, password, role } = validation.data;

        const existingAdmin = await db.selectFrom('admins').select('id').where('email', '=', email).executeTakeFirst();
        if (existingAdmin) {
            return NextResponse.json({ message: 'Email already registered' }, { status: 400 });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newAdmin = await db.insertInto('admins').values({
            name,
            email,
            password: hashedPassword,
            role: role as 'admin' | 'superadmin',
            updatedAt: new Date(),
        }).returningAll().executeTakeFirstOrThrow();

        const token = generateToken({
            id: newAdmin.id,
            email: newAdmin.email,
            role: newAdmin.role as 'admin' | 'superadmin',
        });

        return NextResponse.json({ token, role: newAdmin.role, id: newAdmin.id }, { status: 201 });
    } catch (error) {
        console.error('Admin signup error:', error);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}
