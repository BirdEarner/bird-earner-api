import { getAuthUser } from '@/lib/auth';
import { getTransactionHistory } from '@/lib/services/wallet';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get('page') || '1');
        const limit = parseInt(searchParams.get('limit') || '20');

        const result = await getTransactionHistory(user.id, page, limit);

        return NextResponse.json({
            success: true,
            data: result
        });
    } catch (error: any) {
        console.error('Transaction history error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
