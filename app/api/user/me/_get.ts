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
