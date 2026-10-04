import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { generateToken } from '@/lib/auth';
import { sendEmailVerificationLink } from '@/lib/services/email';
import { validatePerTypeServiceLimits } from '@/lib/service-limits';
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
    workType: z.enum(['remote', 'onsite']).optional().nullable(),
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

        // --- LOG: data received from UI (after zod validation) ---
        console.log('[SIGNUP:UI] received payload:', JSON.stringify({
            email: emailLower,
            mobile,
            full_name,
            gender: profileData.gender,
            dob: profileData.dob,
            workType: profileData.workType,
            termsAccepted: profileData.termsAccepted,
            qualification: profileData.qualification,
            experience: profileData.experience,
            heading: profileData.heading,
            city: profileData.city, state: profileData.state, zipCode: profileData.zipCode, country: profileData.country,
            bio: profileData.bio,
            password: password ? '***' : 'MISSING',
            selectedServices: profileData.selectedServices,
            suggestedService: profileData.suggestedService ? profileData.suggestedService.serviceName : null,
            certifications: profileData.certifications,
            socialLinks: profileData.socialLinks,
            profileImage,
            coverImage,
            portfolioImages: profileData.portfolioImages,
            extraUIKeys: Object.keys(body).filter(k => !(k in { email:1, password:1, full_name:1, mobile:1, selectedServices:1, suggestedService:1, qualification:1, experience:1, heading:1, city:1, state:1, zipCode:1, country:1, gender:1, dob:1, certifications:1, socialLinks:1, bio:1, profileImage:1, coverImage:1, portfolioImages:1, termsAccepted:1, workType:1 })),
        }));

        // Enforce per-type limits (Part 3): current type min 1 / max 5, each type max 5
        const selectedList: string[] = profileData.selectedServices || [];
        const hasSuggested = !!(profileData.suggestedService && profileData.suggestedService.serviceName);
        const limitError = await validatePerTypeServiceLimits(selectedList, profileData.workType ?? null, hasSuggested);
        if (limitError) {
            return NextResponse.json({ success: false, message: limitError }, { status: 400 });
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
            // --- LOG: row being inserted into users table ---
            const userRow = {
                id: userId,
                email: emailLower,
                mobile: mobile,
                password: hashedPassword,
                fullName: full_name,
                gender: profileData.gender || null,
                dob: profileData.dob ? new Date(profileData.dob) : null,
                profilePhoto: profilePhoto,
                emailVerificationToken: emailVerificationToken,
                emailVerificationExpires: emailVerificationExpires,
                updatedAt: new Date(),
            };
            console.log('[SIGNUP:DB] users insert:', JSON.stringify(userRow));
            const user = await trx.insertInto('users').values(userRow).returningAll().executeTakeFirstOrThrow();

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

            // --- LOG: row being inserted into freelancers table ---
            const freelancerRow = {
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
                certifications: profileData.certifications ? JSON.stringify(profileData.certifications) : null,
                socialMediaLinks: profileData.socialLinks ? JSON.stringify(profileData.socialLinks) : null,
                profileDescription: profileData.bio || null,
                portfolioImages: profileData.portfolioImages ? JSON.stringify(profileData.portfolioImages) : null,
                coverPhoto: coverPhoto,
                termsAccepted: profileData.termsAccepted,
                workType: profileData.workType || null,
                phase1Completed: true,
                updatedAt: new Date(),
            };
            console.log('[SIGNUP:DB] freelancers insert:', JSON.stringify(freelancerRow));
            const freelancer = await trx.insertInto('freelancers').values(freelancerRow).returningAll().executeTakeFirstOrThrow();

            // --- LOG: rows actually stored in DB (returned by Postgres) ---
            console.log('[SIGNUP:DB] STORED users row:', JSON.stringify({
                id: user.id, email: user.email, mobile: user.mobile, fullName: user.fullName,
                gender: user.gender, dob: user.dob, profilePhoto: user.profilePhoto,
            }));
            console.log('[SIGNUP:DB] STORED freelancers row:', JSON.stringify({
                id: freelancer.id, userId: freelancer.userId, selectedServices: freelancer.selectedServices,
                highestQualification: freelancer.highestQualification, experience: freelancer.experience,
                profileHeading: freelancer.profileHeading, city: freelancer.city, state: freelancer.state,
                zipcode: freelancer.zipcode, country: freelancer.country, certifications: freelancer.certifications,
                socialMediaLinks: freelancer.socialMediaLinks, profileDescription: freelancer.profileDescription,
                portfolioImages: freelancer.portfolioImages, coverPhoto: freelancer.coverPhoto,
                termsAccepted: freelancer.termsAccepted, workType: freelancer.workType, phase1Completed: freelancer.phase1Completed,
            }));

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

        // Base URL must match how the caller reached us (tunnel/LAN/localhost) so the
        // link opens on both mobile and laptop. Env var wins if explicitly set.
        const reqHost = request.headers.get('host');
        const xfp = request.headers.get('x-forwarded-proto');
        const reqProto = xfp === 'https' || (reqHost && !reqHost.includes(':') && reqHost !== 'localhost') ? 'https' : 'http';
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || (reqHost ? `${reqProto}://${reqHost}` : 'http://localhost:3001');
        const verificationUrl = `${baseUrl}/verify-email?token=${emailVerificationToken}`;
        console.log('[EMAIL] freelancer verification link:', verificationUrl);
        // Fire-and-forget: don't block the signup response on SMTP latency/timeouts
        sendEmailVerificationLink(emailLower, verificationUrl).catch((err) => {
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

    } catch (error: any) {
        console.error('Freelancer registration error:', error);
        if (error.code === '23505' || error.message?.includes('users_mobile_key')) {
            return NextResponse.json({ success: false, message: 'This mobile number is already registered with another account.' }, { status: 400 });
        }
        if (error.code === '23505' || error.message?.includes('users_email_key')) {
            return NextResponse.json({ success: false, message: 'This email address is already in use by another account.' }, { status: 400 });
        }
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
