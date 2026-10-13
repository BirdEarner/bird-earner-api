import { getAuthUser } from '@/lib/auth';
import { sendMessage } from '@/lib/services/chats';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const messageSchema = z.object({
    chatThreadId: z.string(),
    senderId: z.string(),
    receiverId: z.string(),
    messageContent: z.string(),
    messageType: z.string().optional().default('text'),
    attachments: z.array(z.any()).optional(),
    messageData: z.any().optional(),
    senderType: z.string(),
});

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), messageSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const message = await sendMessage(validation.data);

        return NextResponse.json({
            success: true,
            data: message
        });
    } catch (error: any) {
        const message: string = error.message || 'Server error';

        // Refusals we raise on purpose (not server faults) are client errors
        if (/cannot be submitted|waiting for the client|must include a file|dispute is open|not a party|declined your application|Unauthorized/i.test(message)) {
            return NextResponse.json({ success: false, message }, { status: 400 });
        }

        console.error('Send message error:', error);
        return NextResponse.json({
            success: false,
            message
        }, { status: 500 });
    }
}
