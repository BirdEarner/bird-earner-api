import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { generateToken } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const clientRegisterSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    full_name: z.string().min(1),
    designation: z.string().optional().nullable(),
    heading: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    zipCode: z.string().or(z.number().transform(n => n.toString())).optional().nullable(),
    country: z.string().optional().nullable(),
    bio: z.string().optional().nullable(),
    profileImage: z.string().optional().nullable(),
    coverImage: z.string().optional().nullable(),
    termsAccepted: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, clientRegisterSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { email, password, full_name, ...profileData } = validation.data;

        const existingUser = await db.selectFrom('users').select('id').where('email', '=', email).executeTakeFirst();
        if (existingUser) {
            return NextResponse.json({ success: false, message: 'Email already exists' }, { status: 400 });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = crypto.randomUUID();

        const result = await db.transaction().execute(async (trx) => {
            const user = await trx.insertInto('users').values({
                id: userId,
                email,
                password: hashedPassword,
                fullName: full_name,
                updatedAt: new Date(),
            }).returningAll().executeTakeFirstOrThrow();

            const client = await trx.insertInto('clients').values({
                id: crypto.randomUUID(),
                userId: user.id,
                organizationType: profileData.designation,
                companyName: profileData.heading,
                city: profileData.city,
                state: profileData.state,
                zipcode: profileData.zipCode ? parseInt(profileData.zipCode.toString(), 10) : null,
                country: profileData.country,
                profileDescription: profileData.bio,
                profilePhoto: profileData.profileImage,
                coverPhoto: profileData.coverImage,
                termsAccepted: profileData.termsAccepted,
                phase1Completed: true,
                updatedAt: new Date(),
            }).returningAll().executeTakeFirstOrThrow();

            return { user, client };
        });

        const token = generateToken({
            id: result.user.id,
            email: result.user.email,
            role: 'CLIENT',
        });

        const { password: _, ...userWithoutPassword } = result.user;

        return NextResponse.json({
            success: true,
            message: 'Client registered successfully',
            data: {
                ...userWithoutPassword,
                client: result.client,
                token,
            },
        }, { status: 201 });

    } catch (error) {
        console.error('Client registration error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
