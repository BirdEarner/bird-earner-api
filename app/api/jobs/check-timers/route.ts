import { NextResponse } from 'next/server';
import { processJobTimers } from '@/lib/services/timers';

/**
 * Same protection as /api/jobs/cron: timers move money (penalties, refunds, releases),
 * so they can only be triggered with the CRON_SECRET.
 */
function checkCronAuth(request: Request): NextResponse | null {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
        console.error('CRON_SECRET environment variable is not set');
        return NextResponse.json({ success: false, message: 'Server configuration error' }, { status: 500 });
    }
    if (request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
    }
    return null;
}

export async function GET(request: Request) {
    const authError = checkCronAuth(request);
    if (authError) return authError;

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

export async function POST(request: Request) {
    return GET(request);
}
