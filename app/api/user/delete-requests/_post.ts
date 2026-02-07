import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: Request) {
    try {
        const userId = await getUserIdFromRequest(request);
        if (!userId) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { reason } = await request.json();

        // Check for pending request
        const existing = await db
            .selectFrom('deleteRequests')
            .select('id')
            .where('userId', '=', userId)
            .where('status', 'in', ['PENDING', 'APPROVED'])
            .executeTakeFirst();

        if (existing) {
            return NextResponse.json({
                success: false,
                message: 'You already have a pending delete request'
            }, { status: 400 });
        }

        // Get user type (simplified role check)
        const userRoleRaw = await db
            .selectFrom('users')
            .leftJoin('clients', 'users.id', 'clients.userId')
            .leftJoin('freelancers', 'users.id', 'freelancers.userId')
            .select([
                'clients.id as clientId',
                'freelancers.id as freelancerId'
            ])
            .where('users.id', '=', userId)
            .executeTakeFirst();

        const userType = userRoleRaw?.clientId ? 'CLIENT' : userRoleRaw?.freelancerId ? 'FREELANCER' : 'USER';

        const newRequest = await db
            .insertInto('deleteRequests')
            .values({
                id: uuidv4(),
                userId,
                userType,
                reason,
                status: 'PENDING',
                createdAt: new Date(),
                updatedAt: new Date()
            })
            .returningAll()
            .executeTakeFirst();

        return NextResponse.json({
            success: true,
            message: 'Delete request submitted successfully',
            data: newRequest
        });

    } catch (error: any) {
        console.error('Create delete request error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
