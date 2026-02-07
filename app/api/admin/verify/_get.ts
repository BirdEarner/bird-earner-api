import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const adminUser = await getAdminUser();
        if (!adminUser) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const admin = await db
            .selectFrom('admins')
            .select(['id', 'name', 'email', 'role'])
            .where('id', '=', adminUser.id)
            .executeTakeFirst();

        if (!admin) {
            return NextResponse.json({ message: 'User not found' }, { status: 401 });
        }

        return NextResponse.json(admin);
    } catch (error) {
        console.error('Verify admin error:', error);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}
