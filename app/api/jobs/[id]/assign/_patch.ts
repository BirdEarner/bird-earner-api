import { getAuthUser } from '@/lib/auth';
import { assignFreelancer } from '@/lib/services/jobs';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const assignFreelancerSchema = z.object({
    freelancerId: z.string(),
});

export async function PATCH(
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
        const validation = await validateParams(Promise.resolve(body), assignFreelancerSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const result = await assignFreelancer(id, validation.data.freelancerId, user.id);

        // Check if payment is required (insufficient wallet for negotiated amount)
        if (result && (result as any).requiresPayment) {
            return NextResponse.json({
                success: false,
                requiresPayment: true,
                additionalAmount: (result as any).additionalAmount,
                availableBalance: (result as any).availableBalance,
                shortfall: (result as any).shortfall,
                message: (result as any).message
            }, { status: 200 });
        }

        return NextResponse.json({
            success: true,
            message: 'Freelancer assigned successfully',
            data: result
        });
    } catch (error: any) {
        const message = error.message || 'Failed to assign freelancer';
        const isValidationOrBlockError = message.includes('blocked') || message.includes('not found') || message.includes('insufficient') || message.includes('penalty');
        
        if (!isValidationOrBlockError) {
            console.error('Assign freelancer error:', error);
        }

        return NextResponse.json({
            success: false,
            message: message
        }, { status: isValidationOrBlockError ? 400 : 500 });
    }
}
