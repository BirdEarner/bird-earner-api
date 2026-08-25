import { NextResponse } from 'next/server';
import { processJobTimers } from '@/lib/services/timers';

/**
 * Cron endpoint for automatic job deadline enforcement.
 * 
 * Call this endpoint on a schedule (e.g., every 5-15 minutes) from:
 * - Vercel Cron Jobs (vercel.json)
 * - External cron service (cron-job.org, EasyCron, etc.)
 * - GitHub Actions workflow
 * 
 * Requires Authorization header with CRON_SECRET env var.
 * 
 * Example: POST /api/jobs/cron
 * Header: Authorization: Bearer <CRON_SECRET>
 */
export async function POST(request: Request) {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
        console.error('CRON_SECRET environment variable is not set');
        return NextResponse.json(
            { error: 'Server configuration error' },
            { status: 500 }
        );
    }

    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json(
            { error: 'Unauthorized' },
            { status: 401 }
        );
    }

    try {
        await processJobTimers();
        return NextResponse.json({
            success: true,
            message: 'Job timers processed successfully',
            timestamp: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error('Cron job failed:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}

// Also support GET for health checks
export async function GET() {
    return NextResponse.json({
        status: 'ok',
        message: 'Job cron endpoint is active',
        timestamp: new Date().toISOString(),
    });
}
