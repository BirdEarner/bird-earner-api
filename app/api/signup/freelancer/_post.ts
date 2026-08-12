import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { generateToken } from '@/lib/auth';
import { sendEmailVerificationLink } from '@/lib/services/email';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import bcrypt from 'bcryptjs';

const suggestedServiceSchema = z.object({
    serviceName: z.string().min(1, "Service name is required"),
    description: z.string().optional().nullable(),
    images: z.array(z.string()).optional().nullable(),
}).optional().nullable();

const freelancerSignupSchema = z.object({
    email: z.string().email(),
    password: z.string().min(6),
    full_name: z.string().min(1),
    mobile: z.string().min(10).max(15),
    selectedServices: z.array(z.string()).optional().nullable(),
    suggestedService: suggestedServiceSchema,
    qualification: z.string().optional().nullable(),
    experience: z.string().or(z.number().transform(n => n.toString())).optional().nullable(),
    heading: z.string().optional().nullable(),
    city: z.string().optional().nullable(),
    state: z.string().optional().nullable(),
    zipCode: z.string().or(z.number().transform(n => n.toString())).optional().nullable(),
    country: z.string().optional().nullable(),
    gender: z.string().optional().nullable(),
    dob: z.string().optional().nullable(),
    certifications: z.any().optional().nullable(),
    socialLinks: z.any().optional().nullable(),
    bio: z.string().optional().nullable(),
    profileImage: z.any().optional().nullable(),
    portfolioImages: z.any().optional().nullable(),
    coverImage: z.any().optional().nullable(),
    termsAccepted: z.boolean().optional().default(false),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, freelancerSignupSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { email, password, full_name, mobile, profileImage, coverImage, ...profileData } = validation.data;
        const emailLower = email.toLowerCase();

        // Enforce min 1 and max 5 services (including suggested service)
        const selectedList: string[] = profileData.selectedServices || [];
        const hasSuggested = !!(profileData.suggestedService && profileData.suggestedService.serviceName);
        const totalServicesCount = selectedList.length + (hasSuggested ? 1 : 0);

        if (totalServicesCount < 1) {
            return NextResponse.json({ success: false, message: 'Please select at least 1 service or suggest a service.' }, { status: 400 });
        }
        if (totalServicesCount > 5) {
            return NextResponse.json({ success: false, message: 'You can select a maximum of 5 services.' }, { status: 400 });
        }

        const otpRecord = await db
            .selectFrom('otpVerifications')
            .select(['id', 'verified'])
            .where('mobile', '=', mobile)
            .executeTakeFirst();

        if (!otpRecord || !otpRecord.verified) {
            return NextResponse.json({ success: false, message: 'Please verify your mobile number first' }, { status: 400 });
        }

        const profilePhoto = typeof profileImage === 'object' && profileImage?.uri ? profileImage.uri : (typeof profileImage === 'string' ? profileImage : null);
        const coverPhoto = typeof coverImage === 'object' && coverImage?.uri ? coverImage.uri : (typeof coverImage === 'string' ? coverImage : null);

        const existingUser = await db.selectFrom('users').select('id').where('email', '=', emailLower).executeTakeFirst();
        if (existingUser) {
            return NextResponse.json({ success: false, message: 'Email already exists' }, { status: 400 });
        }

        const existingMobile = await db.selectFrom('users').select('id').where('mobile', '=', mobile).executeTakeFirst();
        if (existingMobile) {
            return NextResponse.json({ success: false, message: 'An account with this mobile number already exists' }, { status: 400 });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const userId = crypto.randomUUID();

        const emailVerificationToken = crypto.randomUUID();
        const emailVerificationExpires = String(Date.now() + 5 * 24 * 60 * 60 * 1000);

        const result = await db.transaction().execute(async (trx) => {
            const user = await trx.insertInto('users').values({
                id: userId,
                email: emailLower,
                mobile: mobile,
                password: hashedPassword,
                fullName: full_name,
                emailVerificationToken: emailVerificationToken,
                emailVerificationExpires: emailVerificationExpires,
                updatedAt: new Date(),
            }).returningAll().executeTakeFirstOrThrow();

            let finalServicesList: string[] = [...selectedList];

            console.log('Received suggestedService payload:', profileData.suggestedService);

            if (profileData.suggestedService && profileData.suggestedService.serviceName) {
                const suggestedName = profileData.suggestedService.serviceName.trim();
                console.log('Processing suggested service insertion:', suggestedName);

                // Check if similar service already exists in services table (case-insensitive)
                const matchingService = await trx.selectFrom('services')
                    .select('id')
                    .where((eb) => eb.fn('LOWER', ['name']), '=', suggestedName.toLowerCase())
                    .executeTakeFirst();

                if (matchingService) {
                    console.log('Found existing matching service for suggestion:', matchingService.id);
                    // Status: match
                    // @ts-ignore
                    await trx.insertInto('suggestedServices').values({
                        id: crypto.randomUUID(),
                        userId: user.id,
                        serviceName: suggestedName,
                        description: profileData.suggestedService.description || null,
                        images: profileData.suggestedService.images ? JSON.stringify(profileData.suggestedService.images) : null,
                        status: 'match',
                        matchedServiceId: matchingService.id,
                        updatedAt: new Date(),
                    }).execute();

                    if (!finalServicesList.includes(matchingService.id)) {
                        finalServicesList.push(matchingService.id);
                    }
                } else {
                    // Status: pending
                    const suggestionId = crypto.randomUUID();
                    console.log('Inserting pending suggested service:', suggestionId, suggestedName);
                    // @ts-ignore
                    await trx.insertInto('suggestedServices').values({
                        id: suggestionId,
                        userId: user.id,
                        serviceName: suggestedName,
                        description: profileData.suggestedService.description || null,
                        images: profileData.suggestedService.images ? JSON.stringify(profileData.suggestedService.images) : null,
                        status: 'pending',
                        matchedServiceId: null,
                        updatedAt: new Date(),
                    }).execute();

                    finalServicesList.push(`suggested:${suggestionId}`);
                    console.log('Successfully inserted suggestedService row into suggestedServices table!');
                }
            }

            const freelancer = await trx.insertInto('freelancers').values({
                id: crypto.randomUUID(),
                userId: user.id,
                selectedServices: finalServicesList.length > 0 ? JSON.stringify(finalServicesList) : null,
                highestQualification: profileData.qualification || null,
                experience: profileData.experience ? parseInt(profileData.experience.toString(), 10) : null,
                profileHeading: profileData.heading || null,
                city: profileData.city || null,
                state: profileData.state || null,
                zipcode: profileData.zipCode ? parseInt(profileData.zipCode.toString(), 10) : null,
                country: profileData.country || null,
                gender: profileData.gender || null,
                dob: profileData.dob ? new Date(profileData.dob) : null,
                certifications: profileData.certifications ? JSON.stringify(profileData.certifications) : null,
                socialMediaLinks: profileData.socialLinks ? JSON.stringify(profileData.socialLinks) : null,
                profileDescription: profileData.bio || null,
                profilePhoto: profilePhoto,
                portfolioImages: profileData.portfolioImages ? JSON.stringify(profileData.portfolioImages) : null,
                coverPhoto: coverPhoto,
                termsAccepted: profileData.termsAccepted,
                phase1Completed: true,
                updatedAt: new Date(),
            }).returningAll().executeTakeFirstOrThrow();

            return { user, freelancer };
        });

        const token = generateToken({
            id: result.user.id,
            email: result.user.email,
            role: 'FREELANCER',
        });

        const { password: _, ...userWithoutPassword } = result.user;

        await db.deleteFrom('otpVerifications')
            .where('mobile', '=', mobile)
            .execute();

        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000';
        const verificationUrl = `${baseUrl}/verify-email?token=${emailVerificationToken}`;
        await sendEmailVerificationLink(emailLower, verificationUrl).catch((err) => {
            console.error('Failed to send email verification link:', err);
        });

        return NextResponse.json({
            success: true,
            message: 'Freelancer registered successfully',
            data: {
                ...userWithoutPassword,
                role: 'FREELANCER',
                freelancer: result.freelancer,
                token,
            },
        }, { status: 201 });

    } catch (error) {
        console.error('Freelancer registration error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
