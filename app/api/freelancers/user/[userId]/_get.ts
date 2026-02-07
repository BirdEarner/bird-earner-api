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
