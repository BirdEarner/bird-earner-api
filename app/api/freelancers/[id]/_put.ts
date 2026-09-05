import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();

        // Handle fullName/full_name extraction and specific logic
        const { fullName, full_name, deletedImages, ...freelancerUpdateData } = body;
        const finalFullName = fullName || full_name;

        // Note: deletedImages logic (file system cleanup) is skipped here as it's better handled
        // by a dedicated file management service/cron job or when using cloud storage.
        // If critical, it would need `fs` which might not be idiomatic in Next.js Server Components/API 
        // if deployed to edge, but fine for Node.js runtime. 
        // For now, mirroring DB updates.

        // Get current freelancer to find userId and current selectedServices
        const currentFreelancer = await db
            .selectFrom('freelancers')
            .select(['id', 'userId', 'selectedServices'])
            .where('id', '=', id)
            .executeTakeFirst();

        if (!currentFreelancer) {
            return NextResponse.json({ message: 'Freelancer not found' }, { status: 404 });
        }

        if (finalFullName) {
            await db.updateTable('users')
                .set({ fullName: finalFullName })
                .where('id', '=', currentFreelancer.userId)
                .execute();
        }

        // Prepare update data - ensure JSON fields are stringified if they are objects
        const updatePayload: any = { updatedAt: new Date() };

        // Helper to safe stringify
        const safeStringify = (val: any) => typeof val === 'object' ? JSON.stringify(val) : val;

        // Handle suggestedService if provided
        if (freelancerUpdateData.suggestedService && freelancerUpdateData.suggestedService.serviceName) {
            const suggestedName = freelancerUpdateData.suggestedService.serviceName.trim();
            const matchingService = await db.selectFrom('services')
                .select('id')
                .where((eb) => eb.fn('LOWER', ['name']), '=', suggestedName.toLowerCase())
                .executeTakeFirst();

            let rawServices = freelancerUpdateData.selectedServices !== undefined
                ? freelancerUpdateData.selectedServices
                : currentFreelancer.selectedServices;

            const existingServices: string[] = Array.isArray(rawServices)
                ? [...rawServices]
                : (typeof rawServices === 'string' && rawServices ? (rawServices.startsWith('[') ? JSON.parse(rawServices) : [rawServices]) : []);

            if (matchingService) {
                // @ts-ignore
                await db.insertInto('suggestedServices').values({
                    id: crypto.randomUUID(),
                    userId: currentFreelancer.userId,
                    serviceName: suggestedName,
                    description: freelancerUpdateData.suggestedService.description || null,
                    images: freelancerUpdateData.suggestedService.images ? JSON.stringify(freelancerUpdateData.suggestedService.images) : null,
                    status: 'match',
                    matchedServiceId: matchingService.id,
                    updatedAt: new Date(),
                }).execute();

                if (!existingServices.includes(matchingService.id)) {
                    existingServices.push(matchingService.id);
                }
            } else {
                const suggestionId = crypto.randomUUID();
                // @ts-ignore
                await db.insertInto('suggestedServices').values({
                    id: suggestionId,
                    userId: currentFreelancer.userId,
                    serviceName: suggestedName,
                    description: freelancerUpdateData.suggestedService.description || null,
                    images: freelancerUpdateData.suggestedService.images ? JSON.stringify(freelancerUpdateData.suggestedService.images) : null,
                    status: 'pending',
                    matchedServiceId: null,
                    updatedAt: new Date(),
                }).execute();

                existingServices.push(`suggested:${suggestionId}`);
            }
            updatePayload.selectedServices = JSON.stringify(existingServices);
        } else if (freelancerUpdateData.selectedServices !== undefined) {
            updatePayload.selectedServices = safeStringify(freelancerUpdateData.selectedServices);
        }
        if (freelancerUpdateData.mobileNumber !== undefined) updatePayload.mobileNumber = freelancerUpdateData.mobileNumber;
        if (freelancerUpdateData.highestQualification !== undefined) updatePayload.highestQualification = freelancerUpdateData.highestQualification;
        if (freelancerUpdateData.experience !== undefined) updatePayload.experience = freelancerUpdateData.experience;
        if (freelancerUpdateData.profileHeading !== undefined) updatePayload.profileHeading = freelancerUpdateData.profileHeading;
        if (freelancerUpdateData.city !== undefined) updatePayload.city = freelancerUpdateData.city;
        if (freelancerUpdateData.state !== undefined) updatePayload.state = freelancerUpdateData.state;
        if (freelancerUpdateData.zipcode !== undefined) updatePayload.zipcode = freelancerUpdateData.zipcode;
        if (freelancerUpdateData.country !== undefined) updatePayload.country = freelancerUpdateData.country;
        if (freelancerUpdateData.gender !== undefined) updatePayload.gender = freelancerUpdateData.gender;
        if (freelancerUpdateData.dob !== undefined) updatePayload.dob = new Date(freelancerUpdateData.dob);
        if (freelancerUpdateData.certifications !== undefined) updatePayload.certifications = safeStringify(freelancerUpdateData.certifications);
        if (freelancerUpdateData.socialMediaLinks !== undefined) updatePayload.socialMediaLinks = safeStringify(freelancerUpdateData.socialMediaLinks);
        if (freelancerUpdateData.profileDescription !== undefined) updatePayload.profileDescription = freelancerUpdateData.profileDescription;
        if (freelancerUpdateData.profilePhoto !== undefined) updatePayload.profilePhoto = freelancerUpdateData.profilePhoto;
        if (freelancerUpdateData.portfolioImages !== undefined) updatePayload.portfolioImages = safeStringify(freelancerUpdateData.portfolioImages);
        if (freelancerUpdateData.coverPhoto !== undefined) updatePayload.coverPhoto = freelancerUpdateData.coverPhoto;
        if (freelancerUpdateData.currentlyAvailable !== undefined) updatePayload.currentlyAvailable = freelancerUpdateData.currentlyAvailable;
        if (freelancerUpdateData.nextAvailable !== undefined) updatePayload.nextAvailable = freelancerUpdateData.nextAvailable;
        if (freelancerUpdateData.termsAccepted !== undefined) updatePayload.termsAccepted = freelancerUpdateData.termsAccepted;
        if (freelancerUpdateData.flags !== undefined) updatePayload.flags = safeStringify(freelancerUpdateData.flags);
        if (freelancerUpdateData.freelancerCategory !== undefined) updatePayload.freelancerCategory = freelancerUpdateData.freelancerCategory;
        if (freelancerUpdateData.skills !== undefined) updatePayload.skills = safeStringify(freelancerUpdateData.skills);
        if (freelancerUpdateData.languages !== undefined) updatePayload.languages = safeStringify(freelancerUpdateData.languages);


        if (Object.keys(updatePayload).length > 1) { // 1 because updatedAt is always there
            await db.updateTable('freelancers')
                .set(updatePayload)
                .where('id', '=', id)
                .execute();
        }

        // Return updated data
        const updatedFreelancer = await db
            .selectFrom('freelancers')
            .selectAll('freelancers')
            .innerJoin('users', 'users.id', 'freelancers.userId')
            .select(['users.fullName', 'users.email'])
            .where('freelancers.id', '=', id)
            .executeTakeFirst();

        const finalData = updatedFreelancer ? {
            ...updatedFreelancer,
            user: {
                id: updatedFreelancer.userId,
                email: updatedFreelancer.email,
                fullName: updatedFreelancer.fullName
            }
        } : null;

        return NextResponse.json({
            success: true,
            message: 'Freelancer profile updated successfully',
            data: finalData
        });

    } catch (error: any) {
        console.error('Update freelancer error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 400 });
    }
}
