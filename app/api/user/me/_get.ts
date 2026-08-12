import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const userId = await getUserIdFromRequest();
        if (!userId) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const user = await db
            .selectFrom('users')
            .selectAll()
            .where('id', '=', userId)
            .executeTakeFirst();

        if (!user) {
            return NextResponse.json({ success: false, message: 'User not found' }, { status: 404 });
        }

        const freelancer = await db
            .selectFrom('freelancers')
            .selectAll()
            .where('userId', '=', userId)
            .executeTakeFirst();

        // Clean up orphaned suggested:<uuid> references from selectedServices
        if (freelancer?.selectedServices) {
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
                    const sid = s.replace('suggested:', '');
                    return existingIds.has(sid);
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

        const client = await db
            .selectFrom('clients')
            .selectAll()
            .where('userId', '=', userId)
            .executeTakeFirst();

        const bankAccount = await db
            .selectFrom('bankAccounts')
            .selectAll()
            .where('userId', '=', userId)
            .executeTakeFirst();

        const { password: _, ...userWithoutPassword } = user;

        return NextResponse.json({
            success: true,
            message: 'User data retrieved successfully',
            data: {
                ...userWithoutPassword,
                freelancer,
                client,
                bankAccount,
            },
        });
    } catch (error) {
        console.error('Get me error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
