import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { parseSelectedServices, validatePerTypeServiceLimits } from '@/lib/service-limits';
import type { JobStatus } from '@/types/types';

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
            .select(['id', 'userId', 'selectedServices', 'workType', 'typeChangedAt'])
            .where('id', '=', id)
            .executeTakeFirst();

        if (!currentFreelancer) {
            return NextResponse.json({ message: 'Freelancer not found' }, { status: 404 });
        }

        // ---- Additional rule: job check before allowing an actual type switch ----
        // Runs BEFORE any write so a blocked switch never partially modifies data.
        const requestedWorkType = freelancerUpdateData.workType;
        const isTypeSwitch =
            (requestedWorkType === 'remote' || requestedWorkType === 'onsite') &&
            requestedWorkType !== currentFreelancer.workType;
        let removableThreadIds: string[] = [];

        if (isTypeSwitch) {
            // Ongoing/assigned jobs block the switch. Assignment follows the existing status
            // state machine (VALID_TRANSITIONS in lib/services/jobs.ts): a job counts as
            // ongoing while assigned to this freelancer and NOT in a terminal status.
            // Completed/cancelled/closed/refunded/expired jobs never block (spec rule 3),
            // and the job itself is never modified or deleted.
            const NON_ONGOING_STATUSES: JobStatus[] = [
                'COMPLETED',
                'CANCELLED',
                'CANCELLED_BY_CLIENT',
                'CANCELLED_BY_FREELANCER',
                'CANCELLED_SCOPE_MISMATCH',
                'CLOSED',
                'REFUNDED',
                'EXPIRED',
                'FAILED',
                'DEADLINE_EXPIRED',
                'DISPUTE_RESOLVED',
            ];
            const ongoingJobs = await db
                .selectFrom('jobs')
                .select(['id', 'jobTitle'])
                .where('deleted', '=', false)
                .where('assignedFreelancerId', '=', currentFreelancer.id)
                .where('jobStatus', 'not in', NON_ONGOING_STATUSES)
                .execute();

            if (ongoingJobs.length > 0) {
                return NextResponse.json({
                    success: false,
                    message: "Complete your ongoing job first to switch type."
                }, { status: 400 });
            }

            // Applied-but-not-assigned jobs: their active application (chat thread) will be
            // removed when the switch succeeds. Threads on jobs assigned TO this freelancer
            // (completed history) are never touched. Jobs themselves are never modified.
            const threads = await db
                .selectFrom('chatThreads')
                .innerJoin('jobs', 'jobs.id', 'chatThreads.jobId')
                .select(['chatThreads.id as threadId', 'jobs.assignedFreelancerId'])
                .where('chatThreads.freelancerId', '=', currentFreelancer.id)
                .execute();

            removableThreadIds = threads
                .filter((t) => t.assignedFreelancerId !== currentFreelancer.id)
                .map((t) => t.threadId);
        }

        if (finalFullName) {
            await db.updateTable('users')
                .set({ fullName: finalFullName })
                .where('id', '=', currentFreelancer.userId)
                .execute();
        }

        // Handle user-level fields (profilePhoto, dob, gender) on users table
        const userUpdatePayload: any = {};
        if (freelancerUpdateData.profilePhoto !== undefined) userUpdatePayload.profilePhoto = freelancerUpdateData.profilePhoto;
        if (freelancerUpdateData.dob !== undefined) userUpdatePayload.dob = freelancerUpdateData.dob ? new Date(freelancerUpdateData.dob) : null;
        if (freelancerUpdateData.gender !== undefined) userUpdatePayload.gender = freelancerUpdateData.gender;
        if (Object.keys(userUpdatePayload).length > 0) {
            await db.updateTable('users')
                .set(userUpdatePayload)
                .where('id', '=', currentFreelancer.userId)
                .execute();
        }

        // Prepare update data - ensure JSON fields are stringified if they are objects
        const updatePayload: any = { updatedAt: new Date() };

        // Helper to safe stringify
        const safeStringify = (val: any) => typeof val === 'object' ? JSON.stringify(val) : val;

        // Handle suggestedService if provided
        let suggestedResolvedToList = false;
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
                suggestedResolvedToList = true;
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
        if (freelancerUpdateData.highestQualification !== undefined) updatePayload.highestQualification = freelancerUpdateData.highestQualification;
        if (freelancerUpdateData.experience !== undefined) updatePayload.experience = freelancerUpdateData.experience;
        if (freelancerUpdateData.profileHeading !== undefined) updatePayload.profileHeading = freelancerUpdateData.profileHeading;
        if (freelancerUpdateData.city !== undefined) updatePayload.city = freelancerUpdateData.city;
        if (freelancerUpdateData.state !== undefined) updatePayload.state = freelancerUpdateData.state;
        if (freelancerUpdateData.zipcode !== undefined) updatePayload.zipcode = freelancerUpdateData.zipcode;
        if (freelancerUpdateData.country !== undefined) updatePayload.country = freelancerUpdateData.country;
        if (freelancerUpdateData.certifications !== undefined) updatePayload.certifications = safeStringify(freelancerUpdateData.certifications);
        if (freelancerUpdateData.socialMediaLinks !== undefined) updatePayload.socialMediaLinks = safeStringify(freelancerUpdateData.socialMediaLinks);
        if (freelancerUpdateData.profileDescription !== undefined) updatePayload.profileDescription = freelancerUpdateData.profileDescription;
        if (freelancerUpdateData.portfolioImages !== undefined) updatePayload.portfolioImages = safeStringify(freelancerUpdateData.portfolioImages);
        if (freelancerUpdateData.coverPhoto !== undefined) updatePayload.coverPhoto = freelancerUpdateData.coverPhoto;
        if (freelancerUpdateData.currentlyAvailable !== undefined) updatePayload.currentlyAvailable = freelancerUpdateData.currentlyAvailable;
        if (freelancerUpdateData.nextAvailable !== undefined) updatePayload.nextAvailable = freelancerUpdateData.nextAvailable;
        if (freelancerUpdateData.termsAccepted !== undefined) updatePayload.termsAccepted = freelancerUpdateData.termsAccepted;
        if (freelancerUpdateData.flags !== undefined) updatePayload.flags = safeStringify(freelancerUpdateData.flags);
        if (freelancerUpdateData.freelancerCategory !== undefined) updatePayload.freelancerCategory = freelancerUpdateData.freelancerCategory;
        if (freelancerUpdateData.workType !== undefined) {
            if (freelancerUpdateData.workType !== 'remote' && freelancerUpdateData.workType !== 'onsite') {
                return NextResponse.json({
                    success: false,
                    message: 'workType must be "remote" or "onsite"'
                }, { status: 400 });
            }
            // 14-day cooldown (Part 4): only an ACTUAL type change starts/enforces it
            const isActualTypeChange =
                freelancerUpdateData.workType !== currentFreelancer.workType;
            if (isActualTypeChange) {
                const TYPE_CHANGE_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // exactly 14 x 24 hours
                const lastChange = currentFreelancer.typeChangedAt
                    ? new Date(currentFreelancer.typeChangedAt).getTime()
                    : null;

                if (lastChange !== null && Date.now() - lastChange < TYPE_CHANGE_COOLDOWN_MS) {
                    const remainingMs = TYPE_CHANGE_COOLDOWN_MS - (Date.now() - lastChange);
                    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
                    return NextResponse.json({
                        success: false,
                        message: `Freelancer type can only be changed once every 14 days. Try again in ${remainingDays} day${remainingDays === 1 ? '' : 's'}.`,
                        retryAfterMs: remainingMs
                    }, { status: 400 });
                }
                // Actual change allowed -> record it (never set for same-type updates)
                updatePayload.typeChangedAt = new Date();
            }
            updatePayload.workType = freelancerUpdateData.workType;
        }
        if (freelancerUpdateData.skills !== undefined) updatePayload.skills = safeStringify(freelancerUpdateData.skills);
        if (freelancerUpdateData.languages !== undefined) updatePayload.languages = safeStringify(freelancerUpdateData.languages);


        // Per-type service limits (Part 3) — only when services/type/suggestion are part of this save
        const servicesOrTypeChanged =
            freelancerUpdateData.selectedServices !== undefined ||
            freelancerUpdateData.workType !== undefined ||
            !!(freelancerUpdateData.suggestedService && freelancerUpdateData.suggestedService.serviceName);
        if (servicesOrTypeChanged) {
            const servicesForValidation = updatePayload.selectedServices !== undefined
                ? updatePayload.selectedServices
                : currentFreelancer.selectedServices;
            const effectiveWorkType = updatePayload.workType !== undefined
                ? updatePayload.workType
                : currentFreelancer.workType ?? null;
            const limitError = await validatePerTypeServiceLimits(
                servicesForValidation,
                effectiveWorkType,
                !!(freelancerUpdateData.suggestedService && freelancerUpdateData.suggestedService.serviceName) && !suggestedResolvedToList
            );
            if (limitError) {
                return NextResponse.json({ success: false, message: limitError }, { status: 400 });
            }
        }

        if (Object.keys(updatePayload).length > 1) { // 1 because updatedAt is always there
            if (isTypeSwitch) {
                // Type switch: profile update + removal of unassigned applications in ONE
                // transaction so a failure never leaves partial data behind.
                await db.transaction().execute(async (trx) => {
                    await trx.updateTable('freelancers')
                        .set(updatePayload)
                        .where('id', '=', id)
                        .execute();
                    if (removableThreadIds.length > 0) {
                        // negotiationHistory has ON DELETE RESTRICT; messages survive via ON DELETE SET NULL
                        await trx.deleteFrom('negotiationHistory')
                            .where('chatThreadId', 'in', removableThreadIds)
                            .execute();
                        await trx.deleteFrom('chatThreads')
                            .where('id', 'in', removableThreadIds)
                            .execute();
                    }
                });
            } else {
                await db.updateTable('freelancers')
                    .set(updatePayload)
                    .where('id', '=', id)
                    .execute();
            }
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
