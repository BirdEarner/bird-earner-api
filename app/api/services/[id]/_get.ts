import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        if (id.startsWith('suggested:')) {
            const suggestionId = id.replace('suggested:', '');
            // @ts-ignore
            const suggested = await db
                .selectFrom('suggestedServices')
                .selectAll()
                .where('id', '=', suggestionId)
                .executeTakeFirst();

            if (!suggested) {
                // Suggested service was deleted (likely approved and converted to a real service).
                // Return a graceful fallback instead of 404 so the client doesn't crash.
                return NextResponse.json({
                    success: true,
                    message: 'Suggested service no longer available',
                    data: {
                        id: id,
                        name: 'Service (No longer pending)',
                        category: 'OTHER',
                        description: '',
                        imageUrl: null,
                        isActive: false,
                        isSuggested: true,
                        isMissing: true,
                    }
                });
            }

            if (suggested.matchedServiceId) {
                const matchedService = await db
                    .selectFrom('services')
                    .selectAll()
                    .where('id', '=', suggested.matchedServiceId)
                    .executeTakeFirst();

                if (matchedService) {
                    return NextResponse.json({
                        success: true,
                        message: 'Service retrieved successfully',
                        data: matchedService
                    });
                }
            }

            return NextResponse.json({
                success: true,
                message: 'Suggested service retrieved successfully',
                data: {
                    id: `suggested:${suggested.id}`,
                    name: `${suggested.serviceName} (Pending Approval)`,
                    category: 'OTHER',
                    description: suggested.description || '',
                    imageUrl: null,
                    isActive: false,
                    isSuggested: true,
                    status: suggested.status,
                    createdAt: suggested.createdAt,
                    updatedAt: suggested.updatedAt,
                }
            });
        }

        const service = await db
            .selectFrom('services')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        if (!service) {
            return NextResponse.json({
                success: false,
                message: 'Service not found'
            }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            message: 'Service retrieved successfully',
            data: service
        });

    } catch (error: any) {
        console.error('Get service error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
