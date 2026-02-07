import { db } from '@/lib/db';
import { validateParams } from '@/lib/validation';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const paramsSchema = z.object({
    id: z.string().transform((val) => parseInt(val, 10)),
});

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const paramValidation = await validateParams(params, paramsSchema);
        if (!paramValidation.success) {
            return NextResponse.json({ error: paramValidation.error }, { status: 400 });
        }

        const { id } = paramValidation.data;

        const result = await db
            .deleteFrom('faqTable')
            .where('id', '=', id)
            .executeTakeFirst();

        if (result.numDeletedRows === BigInt(0)) {
            return NextResponse.json({ error: 'FAQ not found' }, { status: 404 });
        }

        return NextResponse.json({ message: 'FAQ deleted successfully' });
    } catch (error) {
        console.error('Error deleting FAQ:', error);
        return NextResponse.json({ error: 'Failed to delete FAQ' }, { status: 500 });
    }
}
