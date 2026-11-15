const SMS_API_URL = process.env.SMS_API_URL || 'https://api.dovesoft.io/api/json/sendsms/';
const DOVESOFT_KEY = process.env.DOVESOFT_KEY || '';
const DOVESOFT_ENTITY_ID = process.env.DOVESOFT_ENTITY_ID || '';
const DOVESOFT_TEMP_ID = process.env.DOVESOFT_TEMP_ID || '1777178575425759992';
const SMS_SENDER_ID = 'BRDERN';

if (!DOVESOFT_KEY) {
    console.warn('[SMS] DOVESOFT_KEY is not set — outbound SMS (OTP/2FA) cannot be delivered. Add DOVESOFT_KEY to .env.');
}

export async function sendSmsOtp(mobile: string, otp: string): Promise<void> {
    const message = `Dear Customer, ${otp} is your OTP to sign in to BirdEarner. This OTP is valid for 10 minutes. Do not share this code.`;

    const payload = {
        listsms: [
            {
                sms: message,
                mobiles: mobile,
                senderid: SMS_SENDER_ID,
                entityid: DOVESOFT_ENTITY_ID,
                tempid: DOVESOFT_TEMP_ID,
            },
        ],
    };

    const response = await fetch(SMS_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            key: DOVESOFT_KEY,
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        const errorText = await response.text();
        console.error('SMS API error:', response.status, errorText);
        throw new Error(`Failed to send SMS: ${response.status}`);
    }

    // The gateway can reply 2xx with an empty or non-JSON body (for example
    // when credentials are missing, or when a proxy returns no content).
    // response.json() used to crash on such replies with
    // "SyntaxError: Unexpected end of JSON input", which surfaced as a 500 on
    // every OTP endpoint that calls this function. Read the body as text and
    // parse defensively: a 2xx means the gateway accepted the request, so an
    // unparseable body is logged, never thrown.
    const raw = await response.text();

    if (!raw.trim()) {
        console.warn(`[SMS] Gateway accepted the request (HTTP ${response.status}) but returned an empty body (DOVESOFT_KEY configured: ${Boolean(DOVESOFT_KEY)}). Delivery cannot be confirmed.`);
        return;
    }

    try {
        const result = JSON.parse(raw);
        console.log('SMS sent successfully:', result);
    } catch {
        console.warn(`[SMS] Gateway returned HTTP ${response.status} with a non-JSON body: ${raw.slice(0, 300)}`);
    }
}
