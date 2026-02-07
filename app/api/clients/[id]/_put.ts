import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();

        // Handle fullName/full_name extraction and specific logic
        const { fullName, full_name, deletedImages, ...clientUpdateData } = body;
        const finalFullName = fullName || full_name;

        // Note: deletedImages logic (file system cleanup) is skipped here 
        // similar to freelancer update for consistency in this migration phase.

        // Get current client to find userId
        const currentClient = await db
            .selectFrom('clients')
            .select('userId')
            .where('id', '=', id)
            .executeTakeFirst();

        if (!currentClient) {
            return NextResponse.json({ message: 'Client not found' }, { status: 404 });
        }

        if (finalFullName) {
            await db.updateTable('users')
                .set({ fullName: finalFullName })
                .where('id', '=', currentClient.userId)
                .execute();
        }

        // Prepare update data
        const updatePayload: any = { updatedAt: new Date() };

        if (clientUpdateData.organizationType !== undefined) updatePayload.organizationType = clientUpdateData.organizationType;
        if (clientUpdateData.companyName !== undefined) updatePayload.companyName = clientUpdateData.companyName;
        if (clientUpdateData.city !== undefined) updatePayload.city = clientUpdateData.city;
        if (clientUpdateData.state !== undefined) updatePayload.state = clientUpdateData.state;
        if (clientUpdateData.zipcode !== undefined) updatePayload.zipcode = clientUpdateData.zipcode;
        if (clientUpdateData.country !== undefined) updatePayload.country = clientUpdateData.country;
        if (clientUpdateData.profileDescription !== undefined) updatePayload.profileDescription = clientUpdateData.profileDescription;
        if (clientUpdateData.profilePhoto !== undefined) updatePayload.profilePhoto = clientUpdateData.profilePhoto;
        if (clientUpdateData.termsAccepted !== undefined) updatePayload.termsAccepted = clientUpdateData.termsAccepted;
        if (clientUpdateData.currentlyAvailable !== undefined) updatePayload.currentlyAvailable = clientUpdateData.currentlyAvailable;
        if (clientUpdateData.nextAvailable !== undefined) updatePayload.nextAvailable = clientUpdateData.nextAvailable;
        if (clientUpdateData.coverPhoto !== undefined) updatePayload.coverPhoto = clientUpdateData.coverPhoto;
        if (clientUpdateData.wallet !== undefined) updatePayload.wallet = clientUpdateData.wallet.toString();
        if (clientUpdateData.availableBalance !== undefined) updatePayload.availableBalance = clientUpdateData.availableBalance.toString();
        if (clientUpdateData.reservedAmount !== undefined) updatePayload.reservedAmount = clientUpdateData.reservedAmount.toString();


        if (Object.keys(updatePayload).length > 1) { // 1 because updatedAt is always there
            await db.updateTable('clients')
                .set(updatePayload)
                .where('id', '=', id)
                .execute();
        }

        // Return updated data
        const updatedClient = await db
            .selectFrom('clients')
            .selectAll('clients')
            .innerJoin('users', 'users.id', 'clients.userId')
            .select(['users.fullName', 'users.email'])
            .where('clients.id', '=', id)
            .executeTakeFirst();

        const finalData = updatedClient ? {
            ...updatedClient,
            user: {
                id: updatedClient.userId,
                email: updatedClient.email,
                fullName: updatedClient.fullName
            }
        } : null;

        return NextResponse.json({
            success: true,
            message: 'Client profile updated successfully',
            data: finalData
        });

    } catch (error: any) {
        console.error('Update client error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 400 });
    }
}
