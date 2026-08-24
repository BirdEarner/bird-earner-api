import { getAuthUser } from '@/lib/auth';
import { requestScopePriceChange, respondToScopePriceChange } from '@/lib/services/jobs';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const priceChangeSchema = z.object({
    type: z.enum(['REQUEST', 'RESPOND']),
    requestedAmount: z.number().optional(),
    reason: z.string().optional(),
    accept: z.boolean().optional(),
});

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const body = await request.json();
        const parsed = priceChangeSchema.parse(body);

        if (parsed.type === 'REQUEST') {
            if (!parsed.requestedAmount || !parsed.reason) {
                return NextResponse.json({ message: 'Requested amount and reason are required' }, { status: 400 });
            }
            const job = await requestScopePriceChange(id, user.id, parsed.requestedAmount, parsed.reason);
            return NextResponse.json({
                success: true,
                message: 'Price change request submitted successfully',
                data: job,
            });
        }

        if (parsed.type === 'RESPOND') {
            if (typeof parsed.accept !== 'boolean') {
                return NextResponse.json({ message: 'Accept boolean flag required' }, { status: 400 });
            }
            const job = await respondToScopePriceChange(id, user.id, parsed.accept);
            return NextResponse.json({
                success: true,
                message: parsed.accept ? 'Price change accepted successfully' : 'Booking cancelled due to scope mismatch',
                data: job,
            });
        }

        throw new Error('Invalid type');
    } catch (error: any) {
        console.error('Price change error:', error);
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to process price change' },
            { status: 500 }
        );
    }
}
