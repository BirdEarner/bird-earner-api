import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { serializeAddress } from '@/lib/addresses';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const rows = await db
            .selectFrom('userAddresses')
            .selectAll()
            .where('userId', '=', user.id)
            .orderBy('lastUsedAt', 'desc')
            .orderBy('createdAt', 'desc')
            .execute();

        return NextResponse.json({
            success: true,
            data: rows.map(serializeAddress),
        });
    } catch (error: unknown) {
        console.error('List addresses error:', error);
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : 'Server error',
            },
            { status: 500 }
        );
    }
}
