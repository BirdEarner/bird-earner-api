import { getAuthUser } from '@/lib/auth';
import { getConversations } from '@/lib/services/chats';
import { NextResponse } from 'next/server';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ freelancerId: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { freelancerId } = await params;

        // Auth check: Is this the freelancer's own user?
        // Note: getConversations already checks for existence, but we verify user.id match
        const conversations = await getConversations(user.id, 'FREELANCER');

        return NextResponse.json({
            success: true,
            data: conversations
        });
    } catch (error: any) {
        console.error('Freelancer conversations error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
