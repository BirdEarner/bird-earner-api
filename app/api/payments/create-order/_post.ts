import { NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/auth';
import { createRazorpayOrder, razorpayKeyId } from '@/lib/services/razorpay';
import { z } from 'zod';
import { validateBody } from '@/lib/validation';
import { db } from '@/lib/db';

const createOrderSchema = z.object({
  amount: z.number().positive(),
  description: z.string().optional(),
  type: z.enum(['WALLET_DEPOSIT', 'SETTLEMENT']).default('WALLET_DEPOSIT'),
});

export async function POST(request: Request) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validationResult = validateBody(body, createOrderSchema);

    if (!validationResult.success) {
      return NextResponse.json({ success: false, message: validationResult.error }, { status: 400 });
    }

    const { amount, description, type = 'WALLET_DEPOSIT' } = validationResult.data;

    // Profile-based authorization: wallet deposits credit a Client wallet, so
    // only a user with a Client profile may initiate one. Settlement payments
    // top up the Freelancer withdrawable balance, so they require a Freelancer
    // profile. This is checked against profile existence (not the JWT role,
    // which is not kept in sync with the active profile switch).
    if (type === 'WALLET_DEPOSIT') {
        const clientProfile = await db
            .selectFrom('clients')
            .select('id')
            .where('userId', '=', userId)
            .executeTakeFirst();

        if (!clientProfile) {
            return NextResponse.json({
                success: false,
                message: 'A Client profile is required to add funds to the Client wallet'
            }, { status: 403 });
        }
    } else if (type === 'SETTLEMENT') {
        const freelancerProfile = await db
            .selectFrom('freelancers')
            .select('id')
            .where('userId', '=', userId)
            .executeTakeFirst();

        if (!freelancerProfile) {
            return NextResponse.json({
                success: false,
                message: 'A Freelancer profile is required to settle the outstanding balance'
            }, { status: 403 });
        }
    }

    // Create Razorpay Order
    const order = await createRazorpayOrder(
      amount,
      `${type.toLowerCase()}_${userId.substring(0, 8)}_${Date.now()}`,
      {
        userId,
        type: type,
        description: description || (type === 'SETTLEMENT' ? 'Outstanding Balance Settlement' : 'Wallet Deposit')
      }
    );

    return NextResponse.json({
      success: true,
      order: {
        id: order.id,
        amount: order.amount,
        currency: order.currency,
        key: razorpayKeyId // Share public key with frontend
      }
    });

  } catch (error: any) {
    console.error('Create Payment Order Error:', error);
    return NextResponse.json({
      success: false,
      message: error.message || 'Failed to initialize payment'
    }, { status: 500 });
  }
}
