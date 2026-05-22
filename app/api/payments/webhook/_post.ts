import { NextResponse } from 'next/server';
import { verifyRazorpayWebhook } from '@/lib/services/razorpay';
import { depositClientFunds, settleFreelancerBalance } from '@/lib/services/wallet';

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
        // payment.captured is triggered when a payment is successful and captured
        if (event.event === 'payment.captured' || event.event === 'order.paid') {
            let orderData;
            let paymentData;

            if (event.event === 'payment.captured') {
                paymentData = event.payload.payment.entity;
                // Fetch order details if needed, or rely on payment notes
                orderData = paymentData.notes; // Notes are often copied from order if configured
                
                // If notes are not in payment entity, try to get them from order if present in payload
                if (!orderData?.userId && event.payload.order) {
                    orderData = event.payload.order.entity.notes;
                }
            } else if (event.event === 'order.paid') {
                orderData = event.payload.order.entity.notes;
                paymentData = event.payload.payment?.entity; // Might not be available in order.paid
            }

            const userId = orderData?.userId;
            const type = orderData?.type || 'WALLET_DEPOSIT';
            const amountInInr = event.payload.order?.entity?.amount 
                ? Number(event.payload.order.entity.amount) / 100 
                : (event.payload.payment?.entity?.amount ? Number(event.payload.payment.entity.amount) / 100 : 0);
            
            const paymentId = event.payload.payment?.entity?.id || `webhook_${Date.now()}`;

            if (!userId || amountInInr <= 0) {
                console.error('Missing userId or amount in webhook payload', { userId, amountInInr });
                // Return 200 to acknowledge receipt even if missing data, to stop retries
                return NextResponse.json({ success: true, message: 'Processed but missing data' });
            }

            // 3. Fulfill payment (Idempotent call)
            if (type === 'SETTLEMENT') {
                await settleFreelancerBalance(
                    userId,
                    amountInInr,
                    `Outstanding balance settlement via Razorpay Webhook (ID: ${paymentId})`,
                    paymentId
                );
            } else {
                await depositClientFunds(
                    userId,
                    amountInInr,
                    `Wallet deposit via Razorpay Webhook (ID: ${paymentId})`,
                    paymentId
                );
            }

            console.log(`Webhook fulfillment successful for User: ${userId}, Type: ${type}, Amount: ${amountInInr}`);
        }

        // Always return 200 OK to Razorpay
        return NextResponse.json({ success: true });

    } catch (error: any) {
        console.error('Razorpay Webhook Error:', error);
        // Still return 200 OK to stop retries from Razorpay if it's a code error
        // Real errors should be investigated via logs
        return NextResponse.json({ success: false, error: error.message }, { status: 200 });
    }
}
