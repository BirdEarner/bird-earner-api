import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { generateToken } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const clientSignupSchema = z.object({
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
    // Legacy support for image objects { uri: '...' } or direct strings
    profileImage: z.any().optional().nullable(),
    coverImage: z.any().optional().nullable(),
    termsAccepted: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, clientSignupSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { email, password, full_name, profileImage, coverImage, ...profileData } = validation.data;
        const emailLower = email.toLowerCase();

        const otpRecord = await db
            .selectFrom('otpVerifications')
            .select(['id', 'verified'])
            .where('email', '=', emailLower)
            .executeTakeFirst();

        if (!otpRecord || !otpRecord.verified) {
            return NextResponse.json({ success: false, message: 'Please verify your email first' }, { status: 400 });
        }

        // Extract URI if image is an object
        const profilePhoto = typeof profileImage === 'object' && profileImage?.uri ? profileImage.uri : (typeof profileImage === 'string' ? profileImage : null);
        const coverPhoto = typeof coverImage === 'object' && coverImage?.uri ? coverImage.uri : (typeof coverImage === 'string' ? coverImage : null);

        const existingUser = await db.selectFrom('users').select('id').where('email', '=', emailLower).executeTakeFirst();
        if (existingUser) {
            return NextResponse.json({ success: false, message: 'Email already exists' }, { status: 400 });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = crypto.randomUUID();

        const result = await db.transaction().execute(async (trx) => {
            const user = await trx.insertInto('users').values({
                id: userId,
                email: emailLower,
                password: hashedPassword,
                fullName: full_name,
                updatedAt: new Date(),
            }).returningAll().executeTakeFirstOrThrow();

            const client = await trx.insertInto('clients').values({
                id: crypto.randomUUID(),
                userId: user.id,
                organizationType: profileData.designation || null,
                companyName: profileData.heading || null,
                city: profileData.city || null,
                state: profileData.state || null,
                zipcode: profileData.zipCode ? parseInt(profileData.zipCode.toString(), 10) : null,
                country: profileData.country || null,
                profileDescription: profileData.bio || null,
                profilePhoto: profilePhoto,
                coverPhoto: coverPhoto,
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

        // Clean up OTP verification record
        await db.deleteFrom('otpVerifications')
            .where('email', '=', emailLower)
            .execute();

        // Mirroring legacy response structure
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
        console.error('Legacy client registration error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
