import Razorpay from 'razorpay';
import crypto from 'crypto';

const razorpayMode = process.env.RAZORPAY_MODE?.trim().toUpperCase() ||
    (process.env.NODE_ENV === 'production' ? 'LIVE' : 'TEST');

const testKeyId = process.env.RAZORPAY_TEST_KEY || process.env.RAZORPAY_TEST_KEY_ID || '';
const testKeySecret = process.env.RAZORPAY_TEST_SECRET || process.env.RAZORPAY_TEST_KEY_SECRET || '';
const liveKeyId = process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_LIVE_KEY || '';
const liveKeySecret = process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_LIVE_SECRET || '';

export const razorpayKeyId = razorpayMode === 'TEST' ? testKeyId : liveKeyId;
const razorpayKeySecret = razorpayMode === 'TEST' ? testKeySecret : liveKeySecret;

if (!razorpayKeyId || !razorpayKeySecret) {
    console.error(`Razorpay ${razorpayMode} credentials are not configured. key_id=${Boolean(razorpayKeyId)}, key_secret=${Boolean(razorpayKeySecret)}`);
}

console.info(`Razorpay mode=${razorpayMode}, using ${razorpayMode === 'TEST' ? 'TEST' : 'LIVE'} credentials`);

const razorpay = new Razorpay({
    key_id: razorpayKeyId,
    key_secret: razorpayKeySecret,
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
    if (!razorpayKeyId || !razorpayKeySecret) {
        const missingFields = [
            !razorpayKeyId && 'key_id',
            !razorpayKeySecret && 'key_secret',
        ].filter(Boolean);
        throw new Error(`Razorpay ${razorpayMode} credentials are missing: ${missingFields.join(', ')}. Set the corresponding environment variables for ${razorpayMode.toLowerCase()} mode.`);
    }

    const options = {
        amount: Math.round(amount * 100), // Razorpay expects amount in paise (1 INR = 100 paise)
        currency: 'INR',
        receipt: receipt || `rcpt_${Date.now()}`,
        notes: notes || {},
    };

    try {
        const order = await razorpay.orders.create(options);
        return order;
    } catch (error: any) {
        console.error('Error creating Razorpay order:', error);
        throw new Error(error?.description || error?.message || 'Failed to create Razorpay order');
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
    const secret = razorpayKeySecret || '';
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
