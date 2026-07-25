import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function DELETE(
    _request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const existing = await db
            .selectFrom('userAddresses')
            .select(['id'])
            .where('id', '=', id)
            .where('userId', '=', user.id)
            .executeTakeFirst();

        if (!existing) {
            return NextResponse.json(
                { success: false, message: 'Address not found' },
                { status: 404 }
            );
        }

        await db
            .deleteFrom('userAddresses')
            .where('id', '=', id)
            .where('userId', '=', user.id)
            .execute();

        return NextResponse.json({
            success: true,
            message: 'Address deleted',
        });
    } catch (error: unknown) {
        console.error('Delete address error:', error);
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : 'Server error',
            },
            { status: 500 }
        );
    }
}
