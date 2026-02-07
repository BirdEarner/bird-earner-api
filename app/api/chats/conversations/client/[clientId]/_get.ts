import { getAuthUser } from '@/lib/auth';
import { getConversations } from '@/lib/services/chats';
import { NextResponse } from 'next/server';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { clientId } = await params;
        const conversations = await getConversations(user.id, 'CLIENT');

        return NextResponse.json({
            success: true,
            data: conversations
        });
    } catch (error: any) {
        console.error('Client conversations error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
