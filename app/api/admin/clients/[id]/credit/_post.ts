import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { z } from 'zod';
import { validateBody } from '@/lib/validation';
import { creditClientRefund } from '@/lib/services/wallet';

const creditSchema = z.object({
    amount: z.number().positive(),
    description: z.string().optional(),
    referenceId: z.string().optional().nullable(),
});

/**
 * Admin-controlled refund/compensation credit into a client wallet.
 *
 * POST /api/admin/clients/[id]/credit
 * Body: { amount, description?, referenceId? }
 *
 * Requires an admin/superadmin session (getAdminUser). Credits are recorded
 * as JOB_REFUND wallet transactions and are idempotent per referenceId.
 */
export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;

        const client = await db
            .selectFrom('clients')
            .select(['id', 'userId'])
            .where('id', '=', id)
            .executeTakeFirst();

        if (!client) {
            return NextResponse.json({ message: 'Client not found' }, { status: 404 });
        }

        const body = await request.json();
        const validation = validateBody(body, creditSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { amount, description, referenceId } = validation.data;

        const result = await creditClientRefund(
            client.userId,
            amount,
            description || 'Refund credited to client wallet',
            referenceId || null
        );

        return NextResponse.json({
            success: true,
            message: result.duplicate
                ? 'Transaction already processed'
                : 'Refund credited successfully',
            data: result
        });
    } catch (error: any) {
        console.error('Credit client refund error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 400 });
    }
}
