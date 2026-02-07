import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { validateBody } from '@/lib/validation';

const createFreelancerSchema = z.object({
    userId: z.string().uuid(),
    fullName: z.string().optional(),
    full_name: z.string().optional(),
    mobileNumber: z.string().optional(),
    selectedServices: z.any().optional(),
    highestQualification: z.string().optional(),
    experience: z.number().optional().default(0),
    profileHeading: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipcode: z.number().optional(),
    country: z.string().optional().default('India'),
    gender: z.string().optional(),
    dob: z.string().optional().nullable(), // ISO string date
    certifications: z.any().optional(),
    socialMediaLinks: z.any().optional(),
    profileDescription: z.string().optional(),
    profilePhoto: z.string().optional(),
    portfolioImages: z.any().optional(),
    coverPhoto: z.string().optional(),
    currentlyAvailable: z.boolean().optional().default(true),
    nextAvailable: z.string().optional(),
    termsAccepted: z.boolean().optional().default(false),
    flags: z.any().optional()
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, createFreelancerSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const data = validation.data;
        const freelancerId = uuidv4();
        const finalFullName = data.fullName || data.full_name;

        // If fullName provided, update user
        if (finalFullName) {
            await db.updateTable('users')
                .set({ fullName: finalFullName })
                .where('id', '=', data.userId)
                .execute();
        }

        const { fullName, full_name, ...freelancerData } = data;

        await db.insertInto('freelancers')
            .values({
                id: freelancerId,
                userId: freelancerData.userId,
                mobileNumber: freelancerData.mobileNumber || null,
                selectedServices: freelancerData.selectedServices ? JSON.stringify(freelancerData.selectedServices) : JSON.stringify([]),
                highestQualification: freelancerData.highestQualification || null,
                experience: freelancerData.experience,
                profileHeading: freelancerData.profileHeading || null,
                city: freelancerData.city || null,
                state: freelancerData.state || null,
                zipcode: freelancerData.zipcode || null,
                country: freelancerData.country,
                gender: freelancerData.gender || null,
                dob: freelancerData.dob ? new Date(freelancerData.dob) : null,
                certifications: freelancerData.certifications ? JSON.stringify(freelancerData.certifications) : JSON.stringify([]),
                socialMediaLinks: freelancerData.socialMediaLinks ? JSON.stringify(freelancerData.socialMediaLinks) : JSON.stringify([]),
                profileDescription: freelancerData.profileDescription || null,
                profilePhoto: freelancerData.profilePhoto || null,
                portfolioImages: freelancerData.portfolioImages ? JSON.stringify(freelancerData.portfolioImages) : JSON.stringify([]),
                coverPhoto: freelancerData.coverPhoto || null,
                currentlyAvailable: freelancerData.currentlyAvailable,
                nextAvailable: freelancerData.nextAvailable || null,
                termsAccepted: freelancerData.termsAccepted,
                flags: freelancerData.flags ? JSON.stringify(freelancerData.flags) : JSON.stringify([]),
                updatedAt: new Date()
            })
            .execute();

        // Fetch created freelancer with user details
        const freelancer = await db
            .selectFrom('freelancers')
            .selectAll('freelancers')
            .innerJoin('users', 'users.id', 'freelancers.userId')
            .select(['users.fullName', 'users.email'])
            .where('freelancers.id', '=', freelancerId)
            .executeTakeFirst();

        const finalData = freelancer ? {
            ...freelancer,
            user: {
                id: freelancer.userId,
                email: freelancer.email,
                fullName: freelancer.fullName
            }
        } : null;


        return NextResponse.json({
            success: true,
            message: 'Freelancer profile created successfully',
            data: finalData
        }, { status: 201 });

    } catch (error: any) {
        console.error('Create freelancer error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 400 });
    }
}
