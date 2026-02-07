import { NextResponse } from 'next/server';

export async function GET() {
    return NextResponse.json({
        terms: process.env.TERMS_AND_CONDITIONS_URL || 'https://birdearner.com/terms',
        privacy: process.env.PRIVACY_POLICY_URL || 'https://birdearner.com/privacy',
    });
}
