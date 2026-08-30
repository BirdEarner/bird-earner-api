import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ threadId: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { threadId } = await params;

        const allMessages = await db
            .selectFrom('messages')
            .selectAll()
            .where('chatThreadId', '=', threadId)
            .orderBy('createdAt', 'asc')
            .execute();

        // Filter out SYSTEM messages not intended for this user
        // Interactive workflow messages (cash_payment, completion_request, review_request) MUST be visible to both parties
        const messages = allMessages.filter((msg) => {
            if (['cash_payment', 'completion_request', 'review_request'].includes(msg.messageType)) {
                return true;
            }
            if (msg.senderType === 'SYSTEM' && msg.receiverId && msg.receiverId !== user.id) {
                return false;
            }
            return true;
        });

        return NextResponse.json({
            success: true,
            data: messages
        });
    } catch (error: any) {
        console.error('Get messages error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
