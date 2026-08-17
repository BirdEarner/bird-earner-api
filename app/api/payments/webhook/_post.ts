import { NextResponse } from 'next/server';
import { verifyRazorpayWebhook } from '@/lib/services/razorpay';
import { settleFreelancerBalance } from '@/lib/services/wallet';

export async function POST(request: Request) {
    try {
        const payload = await request.text();
        const signature = request.headers.get('x-razorpay-signature');

        if (!signature) {
            return NextResponse.json({ error: 'No signature provided' }, { status: 400 });
        }

        // 1. Verify Webhook Signature
        const isValid = verifyRazorpayWebhook(payload, signature);

        if (!isValid) {
            console.error('Invalid Razorpay Webhook Signature');
            return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
        }

        const event = JSON.parse(payload);
        console.log(`Razorpay Webhook Received: ${event.event}`);

        // 2. Handle relevant events
        if (event.event === 'payment.captured' || event.event === 'order.paid') {
            let orderData;
            let paymentData;

            if (event.event === 'payment.captured') {
                paymentData = event.payload.payment.entity;
                orderData = paymentData.notes;
                
                if (!orderData?.userId && event.payload.order) {
                    orderData = event.payload.order.entity.notes;
                }
            } else if (event.event === 'order.paid') {
                orderData = event.payload.order.entity.notes;
                paymentData = event.payload.payment?.entity;
            }

            const userId = orderData?.userId;
            const type = orderData?.type || 'SETTLEMENT';
            const amountInInr = event.payload.order?.entity?.amount 
                ? Number(event.payload.order.entity.amount) / 100 
                : (event.payload.payment?.entity?.amount ? Number(event.payload.payment.entity.amount) / 100 : 0);
            
            const paymentId = event.payload.payment?.entity?.id || `webhook_${Date.now()}`;

            if (!userId || amountInInr <= 0) {
                console.error('Missing userId or amount in webhook payload', { userId, amountInInr });
                return NextResponse.json({ success: true, message: 'Processed but missing data' });
            }

            // 3. Settle freelancer balance (clients pay in cash, no wallet deposits)
            if (type === 'SETTLEMENT') {
                await settleFreelancerBalance(
                    userId,
                    amountInInr,
                    `Outstanding balance settlement via Razorpay Webhook (ID: ${paymentId})`,
                    paymentId
                );
            } else {
                console.log(`Ignoring non-SETTLEMENT webhook type: ${type} for user: ${userId}`);
            }

            console.log(`Webhook fulfillment successful for User: ${userId}, Type: ${type}, Amount: ${amountInInr}`);
        }

        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error('Razorpay Webhook Error:', error);
        return NextResponse.json({ success: false, error: error.message }, { status: 200 });
    }
}
