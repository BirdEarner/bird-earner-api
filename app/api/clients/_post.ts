import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';
import { validateBody } from '@/lib/validation';

const createClientSchema = z.object({
    userId: z.string().uuid(),
    fullName: z.string().optional(),
    full_name: z.string().optional(),
    organizationType: z.string().optional(),
    companyName: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zipcode: z.number().optional(),
    country: z.string().optional().default('India'),
    profileDescription: z.string().optional(),
    profilePhoto: z.string().optional(),
    termsAccepted: z.boolean().optional().default(false),
    currentlyAvailable: z.boolean().optional().default(true),
    nextAvailable: z.string().optional(),
    coverPhoto: z.string().optional()
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, createClientSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const data = validation.data;
        const clientId = uuidv4();
        const finalFullName = data.fullName || data.full_name;

        // If fullName provided, update user
        if (finalFullName) {
            await db.updateTable('users')
                .set({ fullName: finalFullName })
                .where('id', '=', data.userId)
                .execute();
        }

        const { fullName, full_name, ...clientData } = data;

        await db.insertInto('clients')
            .values({
                id: clientId,
                userId: clientData.userId,
                organizationType: clientData.organizationType || null,
                companyName: clientData.companyName || null,
                city: clientData.city || null,
                state: clientData.state || null,
                zipcode: clientData.zipcode || null,
                country: clientData.country,
                profileDescription: clientData.profileDescription || null,
                profilePhoto: clientData.profilePhoto || null,
                termsAccepted: clientData.termsAccepted,
                currentlyAvailable: clientData.currentlyAvailable,
                nextAvailable: clientData.nextAvailable || null,
                coverPhoto: clientData.coverPhoto || null,
                updatedAt: new Date()
            })
            .execute();

        // Fetch created client with user details
        const client = await db
            .selectFrom('clients')
            .selectAll('clients')
            .innerJoin('users', 'users.id', 'clients.userId')
            .select(['users.fullName', 'users.email'])
            .where('clients.id', '=', clientId)
            .executeTakeFirst();

        const finalData = client ? {
            ...client,
            user: {
                id: client.userId,
                email: client.email,
                fullName: client.fullName
            }
        } : null;


        return NextResponse.json({
            success: true,
            message: 'Client profile created successfully',
            data: finalData
        }, { status: 201 });

    } catch (error: any) {
        console.error('Create client error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 400 });
    }
}
