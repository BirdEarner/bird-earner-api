import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { sendNotification } from '@/lib/services/notifications';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const admin = await getAdminUser();
        if (!admin) {
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

        const result = await db.transaction().execute(async (trx) => {
            const updateData: any = {
                status: status as any,
                updatedAt: new Date(),
            };

            if (status === 'PROCESSED') {
                updateData.processedAt = new Date();
            }

            const updated = await trx
                .updateTable('withdrawalRequests')
                .set(updateData)
                .where('id', '=', id)
                .returningAll()
                .executeTakeFirstOrThrow();

            // Get freelancer userId and current balance for notification and transaction
            const freelancer = await trx
                .selectFrom('freelancers')
                .selectAll()
                .where('id', '=', currentRequest.freelancerId)
                .executeTakeFirstOrThrow();

            const restoreAmount = Number(currentRequest.amount);

            // If rejecting from any non-REJECTED status, restore funds
            if (status === 'REJECTED' && currentRequest.status !== 'REJECTED') {
                const balanceBefore = Number(freelancer.withdrawableAmount);
                const balanceAfter = balanceBefore + restoreAmount;

                await trx
                    .updateTable('freelancers')
                    .set({
                        withdrawableAmount: balanceAfter.toString(),
                        updatedAt: new Date()
                    })
                    .where('id', '=', currentRequest.freelancerId)
                    .execute();

                // Log reversal in wallet transactions
                await trx
                    .insertInto('walletTransactions')
                    .values({
                        id: crypto.randomUUID(),
                        userId: freelancer.userId,
                        userType: 'FREELANCER',
                        jobId: null,
                        transactionType: 'BONUS',
                        amount: restoreAmount.toFixed(2),
                        balanceBefore: balanceBefore.toFixed(2),
                        balanceAfter: balanceAfter.toFixed(2),
                        description: 'Withdrawal request rejected - funds restored',
                        referenceId: id,
                        updatedAt: new Date()
                    })
                    .execute();
            }

            return { ...updated, freelancer };
        });

        // Build notification message based on status
        const notificationTitle = status === 'REJECTED'
            ? 'Withdrawal Rejected'
            : status === 'APPROVED'
                ? 'Withdrawal Approved'
                : 'Withdrawal Processed';

        const notificationBody = status === 'REJECTED'
            ? `Your withdrawal request for ₹${currentRequest.amount} has been rejected. The amount has been restored to your wallet.`
            : `Your withdrawal request for ₹${currentRequest.amount} has been ${status.toLowerCase()}.`;

        // Send notification
        try {
            await sendNotification(
                result.freelancer.userId,
                'FREELANCER',
                notificationTitle,
                notificationBody,
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
