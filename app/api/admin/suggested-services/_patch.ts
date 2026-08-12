import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { validateBody } from '@/lib/validation';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const patchSchema = z.object({
    id: z.string().min(1, 'Suggestion ID is required'),
    action: z.enum(['match', 'approve', 'reject']),
    matchedServiceId: z.string().optional().nullable(),
    category: z.enum(['FREELANCE', 'HOUSEHOLD']).optional().default('FREELANCE'),
    description: z.string().optional().nullable(),
    imageUrl: z.string().optional().nullable(),
});

export async function PATCH(request: NextRequest) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = validateBody(body, patchSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { id, action, matchedServiceId, category, description, imageUrl } = validation.data;

        // Fetch suggestion record
        // @ts-ignore
        const suggestion = await db.selectFrom('suggestedServices')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        if (!suggestion) {
            return NextResponse.json({ success: false, message: 'Suggested service request not found' }, { status: 404 });
        }

        const result = await db.transaction().execute(async (trx) => {
            let finalMatchedId: string | null = null;
            let newStatus: string = action;

            if (action === 'match') {
                if (!matchedServiceId) {
                    throw new Error('matchedServiceId is required for match action');
                }
                const existingService = await trx.selectFrom('services')
                    .select('id')
                    .where('id', '=', matchedServiceId)
                    .executeTakeFirst();

                if (!existingService) {
                    throw new Error('Selected service to match was not found');
                }
                finalMatchedId = existingService.id;
                newStatus = 'match';
            } else if (action === 'reject') {
                finalMatchedId = null;
                newStatus = 'reject';
            } else if (action === 'approve') {
                // Check if a service with the same name already exists in services table
                const existingByName = await trx.selectFrom('services')
                    .select('id')
                    .where((eb) => eb.fn('LOWER', ['name']), '=', suggestion.serviceName.trim().toLowerCase())
                    .executeTakeFirst();

                if (existingByName) {
                    finalMatchedId = existingByName.id;
                } else {
                    const createdService = await trx.insertInto('services').values({
                        id: crypto.randomUUID(),
                        name: suggestion.serviceName.trim(),
                        // @ts-ignore
                        category: category || 'FREELANCE',
                        description: description || suggestion.description || null,
                        imageUrl: imageUrl || null,
                        isActive: true,
                        updatedAt: new Date(),
                    }).returningAll().executeTakeFirstOrThrow();

                    finalMatchedId = createdService.id;
                }
                newStatus = 'approve';
            }

            // Update suggestedServices row
            // @ts-ignore
            const updatedSuggestion = await trx.updateTable('suggestedServices')
                .set({
                    status: newStatus,
                    matchedServiceId: finalMatchedId,
                    updatedAt: new Date(),
                })
                .where('id', '=', id)
                .returningAll()
                .executeTakeFirstOrThrow();

            // Update Freelancer's selectedServices array if freelancer profile exists
            const freelancer = await trx.selectFrom('freelancers')
                .select(['id', 'selectedServices'])
                .where('userId', '=', suggestion.userId)
                .executeTakeFirst();

            if (freelancer) {
                let servicesArr: string[] = [];
                if (freelancer.selectedServices) {
                    try {
                        servicesArr = typeof freelancer.selectedServices === 'string'
                            ? JSON.parse(freelancer.selectedServices)
                            : freelancer.selectedServices;
                    } catch {
                        servicesArr = [];
                    }
                }

                // Remove placeholder suggested:id
                servicesArr = servicesArr.filter(s => s !== `suggested:${id}`);

                if (finalMatchedId && (action === 'match' || action === 'approve')) {
                    if (!servicesArr.includes(finalMatchedId)) {
                        servicesArr.push(finalMatchedId);
                    }
                }

                await trx.updateTable('freelancers')
                    .set({
                        selectedServices: JSON.stringify(servicesArr),
                        updatedAt: new Date(),
                    })
                    .where('id', '=', freelancer.id)
                    .execute();
            }

            return updatedSuggestion;
        });

        return NextResponse.json({
            success: true,
            message: `Suggested service ${action}ed successfully`,
            data: result
        });

    } catch (error: any) {
        console.error('Patch suggested service error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Internal server error'
        }, { status: 500 });
    }
}
