import { getAuthUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

const reportSchema = z.object({
    threadId: z.string().optional(),
    reason: z.string().min(1, 'Reason is required'),
    reportedUserId: z.string().optional(),
    details: z.string().optional(),
});

export async function POST(request: Request) {
    try {
        const authUser = await getAuthUser();
        if (!authUser) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const parsed = reportSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                { success: false, message: parsed.error.issues[0]?.message || 'Invalid input' },
                { status: 400 }
            );
        }

        const { threadId, reason, reportedUserId, details } = parsed.data;

        // Fetch reporting user info from DB
        const reportingUser = await db
            .selectFrom('users')
            .select(['fullName', 'email'])
            .where('id', '=', authUser.id)
            .executeTakeFirst();

        // Fetch reported user info if reportedUserId is provided
        let reportedUserEmail = 'N/A';
        let reportedUserName = 'N/A';
        if (reportedUserId) {
            const rUser = await db
                .selectFrom('users')
                .select(['fullName', 'email'])
                .where('id', '=', reportedUserId)
                .executeTakeFirst();
            if (rUser) {
                reportedUserName = rUser.fullName || 'N/A';
                reportedUserEmail = rUser.email || 'N/A';
            }
        }

        const ticketId = `TKT-REP-${Math.floor(100000 + Math.random() * 900000)}`;
        const subject = `[Chat Report] Reason: ${reason}`;
        const messageContent = [
            `Reason: ${reason}`,
            details ? `Details: ${details}` : null,
            `Reported User ID: ${reportedUserId || 'N/A'} (${reportedUserName} - ${reportedUserEmail})`,
            `Reporter User ID: ${authUser.id} (${reportingUser?.fullName || 'N/A'} - ${reportingUser?.email || authUser.email})`,
            `Thread ID: ${threadId || 'N/A'}`,
        ]
            .filter(Boolean)
            .join('\n');

        const newContact = await db
            .insertInto('contacts')
            .values({
                id: uuidv4(),
                ticketId,
                name: reportingUser?.fullName || authUser.email || 'User',
                email: reportingUser?.email || authUser.email || 'no-email@birdearner.com',
                phone: null,
                subject,
                message: messageContent,
                status: 'pending',
                isRead: false,
                createdAt: new Date(),
                updatedAt: new Date(),
            })
            .returningAll()
            .executeTakeFirst();

        return NextResponse.json({
            success: true,
            message: 'Report submitted successfully',
            data: {
                ticketId: newContact?.ticketId || ticketId,
            },
        });
    } catch (error: any) {
        console.error('Submit report error:', error);
        return NextResponse.json(
            {
                success: false,
                message: error.message || 'Server error while submitting report',
            },
            { status: 500 }
        );
    }
}
