import { getAuthUser } from '@/lib/auth';
import { getFreelancerWallet } from '@/lib/services/wallet';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        let freelancerWallet = null;

        try {
            freelancerWallet = await getFreelancerWallet(user.id);
        } catch (e) { }

        return NextResponse.json({
            success: true,
            data: {
                client: null,
                freelancer: freelancerWallet
            }
        });
    } catch (error: any) {
        console.error('Wallet balance error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
