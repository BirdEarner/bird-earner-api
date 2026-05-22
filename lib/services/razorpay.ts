import Razorpay from 'razorpay';
import crypto from 'crypto';

/**
 * Initialize Razorpay instance
 * Ensure RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are in environment variables
 */
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID || '',
    key_secret: process.env.RAZORPAY_KEY_SECRET || '',
});

export default razorpay;

/**
 * Create a new Razorpay Order
 * @param amount Amount in INR (e.g., 100 for ₹100.00)
 * @param receipt Optional receipt ID for tracking
 * @param notes Optional metadata
 */
export async function createRazorpayOrder(
    amount: number,
    receipt?: string,
    notes?: Record<string, string>
) {
    const options = {
        amount: Math.round(amount * 100), // Razorpay expects amount in paise (1 INR = 100 paise)
        currency: 'INR',
        receipt: receipt || `rcpt_${Date.now()}`,
        notes: notes || {},
    };

    try {
        const order = await razorpay.orders.create(options);
        return order;
    } catch (error) {
        console.error('Error creating Razorpay order:', error);
        throw new Error('Failed to create Razorpay order');
    }
}

/**
 * Verify Razorpay Payment Signature
 * @param orderId Razorpay Order ID
 * @param paymentId Razorpay Payment ID
 * @param signature Razorpay Signature
 */
export function verifyRazorpaySignature(
    orderId: string,
    paymentId: string,
    signature: string
) {
    const secret = process.env.RAZORPAY_KEY_SECRET || '';
    const body = orderId + '|' + paymentId;

    const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(body.toString())
        .digest('hex');

    return expectedSignature === signature;
}

/**
 * Verify Razorpay Webhook Signature
 * @param payload Raw request body as string
 * @param signature Value from x-razorpay-signature header
 */
export function verifyRazorpayWebhook(
    payload: string,
    signature: string
) {
    const webhookSecret = process.env.RAZORPAY_WEBHOOK_SECRET || '';
    
    if (!webhookSecret) {
        console.warn('RAZORPAY_WEBHOOK_SECRET is not set. Webhook verification will fail.');
        return false;
    }

    const expectedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(payload)
        .digest('hex');

    return expectedSignature === signature;
}
