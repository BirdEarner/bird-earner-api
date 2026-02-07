import { getAuthUser } from '@/lib/auth';
import { settleFreelancerBalance } from '@/lib/services/wallet';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const settleSchema = z.object({
    amount: z.number().positive(),
    description: z.string().optional(),
    referenceId: z.string().nullable().optional(),
});

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), settleSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { amount, description, referenceId } = validation.data;

        const result = await settleFreelancerBalance(
            user.id,
            amount,
            description || 'Balance settlement',
            referenceId || null
        );

        return NextResponse.json({
            success: true,
            message: 'Balance settled successfully',
            data: result
        });
    } catch (error: any) {
        console.error('Freelancer settlement error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
