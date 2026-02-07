import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';
import { sendNotification } from '@/lib/services/notifications';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const userId = await getUserIdFromRequest(request);
        if (!userId) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { status } = await request.json();
        const validStatuses = ['PENDING', 'APPROVED', 'PROCESSED', 'REJECTED'];
        if (!validStatuses.includes(status)) {
            return NextResponse.json({ success: false, message: 'Invalid status' }, { status: 400 });
        }

        // Get current request
        const currentRequest = await db
            .selectFrom('withdrawalRequests')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        if (!currentRequest) {
            return NextResponse.json({ success: false, message: 'Withdrawal request not found' }, { status: 404 });
        }

        // Use Prisma for transaction as Kysely transaction support might be complex here
        // Wait, I should use the prisma client directly if available or use kysely transaction
        const prisma = (await import('@/lib/db')).prisma;

        const result = await prisma.$transaction(async (tx) => {
            const updateData: any = {
                status: status as any,
                updatedAt: new Date(),
            };

            if (status === 'PROCESSED') {
                updateData.processedAt = new Date();
            }

            const updated = await tx.withdrawalRequest.update({
                where: { id },
                data: updateData,
                include: {
                    freelancer: true
                }
            });

            // If rejecting, restore funds
            if (status === 'REJECTED' && currentRequest.status === 'PENDING') {
                await tx.freelancer.update({
                    where: { id: currentRequest.freelancerId },
                    data: {
                        withdrawableAmount: {
                            increment: Number(currentRequest.amount)
                        }
                    }
                });
            }

            return updated;
        });

        // Send notification
        try {
            await sendNotification(
                result.freelancer.userId,
                'FREELANCER',
                'Withdrawal Processed',
                `Your withdrawal request for ₹${currentRequest.amount} has been ${status.toLowerCase()}.`,
                'PAYMENT',
                {
                    requestId: id,
                    status: status,
                    amount: String(currentRequest.amount)
                }
            );
        } catch (notificationError) {
            console.error('Failed to send withdrawal notification:', notificationError);
        }

        return NextResponse.json({
            success: true,
            data: result
        });

    } catch (error: any) {
        console.error('Withdrawal update error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
