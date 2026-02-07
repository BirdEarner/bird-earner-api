import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ userId: string }> }
) {
    try {
        const { userId } = await params;

        const client = await db
            .selectFrom('clients')
            .selectAll()
            .where('userId', '=', userId)
            .executeTakeFirst();

        if (!client) {
            return NextResponse.json({
                success: true,
                message: 'Client profile not found',
                data: null
            });
        }

        // Fetch user details to include
        const user = await db
            .selectFrom('users')
            .select(['id', 'email', 'fullName'])
            .where('id', '=', userId)
            .executeTakeFirst();

        const data = {
            ...client,
            user: user || null
        };

        return NextResponse.json({
            success: true,
            message: 'Client profile retrieved successfully',
            data
        });

    } catch (error: any) {
        console.error('Get client by userId error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
