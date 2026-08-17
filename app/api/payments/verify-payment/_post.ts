import { NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/auth';
import razorpay, { verifyRazorpaySignature } from '@/lib/services/razorpay';
import { settleFreelancerBalance } from '@/lib/services/wallet';
import { z } from 'zod';
import { validateBody } from '@/lib/validation';

const verifyPaymentSchema = z.object({
  razorpay_order_id: z.string(),
  razorpay_payment_id: z.string(),
  razorpay_signature: z.string(),
});

export async function POST(request: Request) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validationResult = validateBody(body, verifyPaymentSchema);

    if (!validationResult.success) {
      return NextResponse.json({ success: false, message: validationResult.error }, { status: 400 });
    }

    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = validationResult.data;

    // 1. Verify Signature
    const isValid = verifyRazorpaySignature(
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    );

    if (!isValid) {
      return NextResponse.json({ success: false, message: 'Invalid payment signature' }, { status: 400 });
    }

    // 2. Fetch Order from Razorpay to verify amount and owner
    const order = await razorpay.orders.fetch(razorpay_order_id);
    
    // Verify this order belongs to this user (stored in notes during creation)
    if (order.notes?.userId !== userId) {
        return NextResponse.json({ success: false, message: 'Order ownership mismatch' }, { status: 403 });
    }

    // 3. Settle freelancer balance
    const amountInInr = Number(order.amount) / 100;
    const paymentType = order.notes?.type || 'SETTLEMENT';
    
    if (paymentType !== 'SETTLEMENT') {
        return NextResponse.json({ success: false, message: 'Client wallet deposits are not supported. Clients pay in cash.' }, { status: 400 });
    }

    const result = await settleFreelancerBalance(
        userId,
        amountInInr,
        `Outstanding balance settlement via Razorpay (ID: ${razorpay_payment_id})`,
        razorpay_payment_id
    );

    return NextResponse.json({
      success: true,
      message: 'Balance settled successfully',
      data: result
    });

  } catch (error: any) {
    console.error('Verify Payment Error:', error);
    return NextResponse.json({
      success: false,
      message: error.message || 'Payment verification failed'
    }, { status: 500 });
  }
}
