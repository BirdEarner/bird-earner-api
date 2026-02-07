import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: Request) {
    try {
        const { name, email, subject, message, mobileNumber } = await request.json();

        if (!email || !message) {
            return NextResponse.json({ success: false, message: 'Email and message are required' }, { status: 400 });
        }

        const ticketId = `TKT-${Math.floor(100000 + Math.random() * 900000)}`;

        const newContact = await db
            .insertInto('contacts')
            .values({
                id: uuidv4(),
                name,
                email,
                subject,
                message,
                phone: mobileNumber, // Use 'phone' instead of 'mobileNumber'
                ticketId,
                status: 'pending', // Lowercase per schema
                isRead: false,
                createdAt: new Date(),
                updatedAt: new Date()
            })
            .returningAll()
            .executeTakeFirst();

        return NextResponse.json({
            success: true,
            message: 'Contact form submitted successfully',
            data: {
                ticketId: newContact?.ticketId
            }
        });

    } catch (error: any) {
        console.error('Contact submission error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
