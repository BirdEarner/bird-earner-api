const SMS_API_URL = 'https://api.dovesoft.io/api/json/sendsms/';
const DOVESOFT_KEY = process.env.DOVESOFT_KEY || '';
const DOVESOFT_ENTITY_ID = process.env.DOVESOFT_ENTITY_ID || '';
const DOVESOFT_TEMP_ID = process.env.DOVESOFT_TEMP_ID || '1777178575425759992';
const SMS_SENDER_ID = 'BRDERN';

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

    const result = await response.json();
    console.log('SMS sent successfully:', result);
}
