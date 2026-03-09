import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const user = await db
            .selectFrom('users')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        if (!user) {
            return NextResponse.json({
                success: false,
                message: 'User not found'
            }, { status: 404 });
        }

        // Remove password from response
        const { password, ...userWithoutPassword } = user;

        // Fetch related profiles
        const freelancerProfile = await db.selectFrom('freelancers').selectAll().where('userId', '=', id).executeTakeFirst();
        const clientProfile = await db.selectFrom('clients').selectAll().where('userId', '=', id).executeTakeFirst();

        return NextResponse.json({
            success: true,
            message: 'User retrieved successfully',
            data: {
                ...userWithoutPassword,
                ...(freelancerProfile ? { freelancer: freelancerProfile } : {}),
                ...(clientProfile ? { client: clientProfile } : {})
            }
        });

    } catch (error: any) {
        console.error('Get user error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
