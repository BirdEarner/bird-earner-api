import { getAuthUser } from '@/lib/auth';
import { submitDigitalWork, respondToDigitalWork } from '@/lib/services/jobs';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const submissionSchema = z.object({
    type: z.enum(['SUBMIT', 'RESPOND']),
    fileUrl: z.string().optional(),
    notes: z.string().optional(),
    watermarkText: z.string().optional(),
    decision: z.enum(['ACCEPT', 'REQUEST_REVISION']).optional(),
});

export async function POST(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        const body = await request.json();
        const parsed = submissionSchema.parse(body);

        if (parsed.type === 'SUBMIT') {
            if (!parsed.fileUrl) {
                return NextResponse.json({ message: 'File URL required for submission' }, { status: 400 });
            }
            const job = await submitDigitalWork(id, user.id, {
                fileUrl: parsed.fileUrl,
                notes: parsed.notes,
                watermarkText: parsed.watermarkText,
            });
            return NextResponse.json({
                success: true,
                message: 'Work submitted for review successfully',
                data: job,
            });
        }

        if (parsed.type === 'RESPOND') {
            if (!parsed.decision) {
                return NextResponse.json({ message: 'Decision required (ACCEPT or REQUEST_REVISION)' }, { status: 400 });
            }
            const job = await respondToDigitalWork(id, user.id, parsed.decision, parsed.notes);
            return NextResponse.json({
                success: true,
                message: `Work ${parsed.decision.toLowerCase()}ed successfully`,
                data: job,
            });
        }

        throw new Error('Invalid submission type');
    } catch (error: any) {
        console.error('Work submission error:', error);
        return NextResponse.json(
            { success: false, message: error.message || 'Failed to process work submission' },
            { status: 500 }
        );
    }
}
