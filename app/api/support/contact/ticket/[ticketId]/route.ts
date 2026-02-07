import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ ticketId: string }> }
) {
    try {
        const { ticketId } = await params;

        const contact = await db
            .selectFrom('contacts')
            .selectAll()
            .where('ticketId', '=', ticketId)
            .executeTakeFirst();

        if (!contact) {
            return NextResponse.json({ success: false, message: 'Ticket not found' }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            data: contact
        });

    } catch (error: any) {
        console.error('Get contact by ticket id error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
