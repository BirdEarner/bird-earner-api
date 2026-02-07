import { getAuthUser } from '@/lib/auth';
import { getClientWallet, getFreelancerWallet } from '@/lib/services/wallet';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        let clientWallet = null;
        let freelancerWallet = null;

        try {
            clientWallet = await getClientWallet(user.id);
        } catch (e) { }

        try {
            freelancerWallet = await getFreelancerWallet(user.id);
        } catch (e) { }

        return NextResponse.json({
            success: true,
            data: {
                client: clientWallet,
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
