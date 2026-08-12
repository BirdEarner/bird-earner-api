import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ userId: string }> }
) {
    try {
        const { userId } = await params;

        const freelancer = await db
            .selectFrom('freelancers')
            .selectAll()
            .where('userId', '=', userId)
            .executeTakeFirst();

        if (!freelancer) {
            return NextResponse.json({
                success: false,
                message: 'Freelancer profile not found'
            }, { status: 404 });
        }

        // Clean up orphaned suggested:<uuid> references
        if (freelancer.selectedServices) {
            let services: string[] = [];
            try {
                services = typeof freelancer.selectedServices === 'string'
                    ? JSON.parse(freelancer.selectedServices)
                    : freelancer.selectedServices;
            } catch { services = []; }

            const suggestedIds = services
                .filter(s => s.startsWith('suggested:'))
                .map(s => s.replace('suggested:', ''));

            if (suggestedIds.length > 0) {
                const existing = await db
                    .selectFrom('suggestedServices')
                    .select('id')
                    .where('id', 'in', suggestedIds)
                    .execute();

                const existingIds = new Set(existing.map(e => e.id));
                const cleaned = services.filter(s => {
                    if (!s.startsWith('suggested:')) return true;
                    return existingIds.has(s.replace('suggested:', ''));
                });

                if (cleaned.length !== services.length) {
                    await db.updateTable('freelancers')
                        .set({ selectedServices: JSON.stringify(cleaned), updatedAt: new Date() })
                        .where('userId', '=', userId)
                        .execute();
                    freelancer.selectedServices = JSON.stringify(cleaned);
                }
            }
        }

        // Fetch user details to include
        const user = await db
            .selectFrom('users')
            .select(['id', 'email', 'fullName'])
            .where('id', '=', userId)
            .executeTakeFirst();

        const data = {
            ...freelancer,
            user: user || null
        };

        return NextResponse.json({
            success: true,
            message: 'Freelancer profile retrieved successfully',
            data
        });

    } catch (error: any) {
        console.error('Get freelancer by userId error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
