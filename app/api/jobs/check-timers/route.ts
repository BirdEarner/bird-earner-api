import { NextResponse } from 'next/server';
import { processJobTimers } from '@/lib/services/timers';

export async function GET() {
    try {
        await processJobTimers();
        return NextResponse.json({
            success: true,
            message: 'Job timers processed successfully',
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error('Error processing job timers:', error);
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to process job timers' },
            { status: 500 }
        );
    }
}

export async function POST() {
    return GET();
}
