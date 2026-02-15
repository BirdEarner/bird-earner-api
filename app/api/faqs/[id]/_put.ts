import { db } from '@/lib/db';
import { validateBody, validateParams } from '@/lib/validation';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const updateFaqSchema = z.object({
    question: z.string().min(1, 'Question is required'),
    answer: z.string().min(1, 'Answer is required'),
    category: z.string().min(1, 'Category is required'),
    keywords: z.string().optional().nullable(),
    youtubeLink: z.string().optional().nullable(),
});

const paramsSchema = z.object({
    id: z.string(),
});

export async function PUT(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const paramValidation = await validateParams(params, paramsSchema);
        if (!paramValidation.success) {
            return NextResponse.json({ error: paramValidation.error }, { status: 400 });
        }

        const { id } = paramValidation.data;
        const body = await request.json();
        const validation = validateBody(body, updateFaqSchema);

        if (!validation.success) {
            return NextResponse.json({ error: validation.error }, { status: 400 });
        }

        const updatedFaq = await db
            .updateTable('faqTable')
            .set({
                question: validation.data.question,
                answer: validation.data.answer,
                category: validation.data.category,
                keywords: validation.data.keywords,
                youtubeLink: validation.data.youtubeLink,
            })
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirst();

        if (!updatedFaq) {
            return NextResponse.json({ error: 'FAQ not found' }, { status: 404 });
        }

        return NextResponse.json(updatedFaq);
    } catch (error) {
        console.error(`Error updating FAQ:`, error);
        return NextResponse.json({ error: 'Failed to update FAQ' }, { status: 500 });
    }
}
