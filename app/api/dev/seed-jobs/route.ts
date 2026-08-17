import { NextResponse } from 'next/server';

export async function GET() {
    return NextResponse.json({
        message: 'This is a one-time seed endpoint. It has already been used. Delete this file.',
    });
}
