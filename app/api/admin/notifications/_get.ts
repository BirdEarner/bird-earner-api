import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        }

        const notifications = await db
            .selectFrom('notifications')
            .selectAll()
            .orderBy('createdAt', 'desc')
            .execute();

        return NextResponse.json(notifications);

    } catch (error: any) {
        console.error('List notifications error:', error);
        return NextResponse.json({ message: error.message || 'Server error' }, { status: 500 });
    }
}
