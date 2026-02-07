import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const adminUser = await getAdminUser();
        if (!adminUser || adminUser.role !== 'superadmin') {
            return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        }

        const admins = await db
            .selectFrom('admins')
            .select(['id', 'name', 'email', 'role', 'createdAt', 'updatedAt', 'lastLoginAt'])
            .orderBy('createdAt', 'desc')
            .execute();

        return NextResponse.json(admins);
    } catch (error) {
        console.error('Get all admins error:', error);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}
