import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const createFaqSchema = z.object({
    question: z.string().min(1, 'Question is required'),
    answer: z.string().min(1, 'Answer is required'),
    category: z.string().min(1, 'Category is required'),
    keywords: z.string().optional().nullable(),
    youtubeLink: z.string().optional().nullable(),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, createFaqSchema);

        if (!validation.success) {
            return NextResponse.json({ error: validation.error }, { status: 400 });
        }

        const newFaq = await db
            .insertInto('faqTable')
            .values({
                id: crypto.randomUUID(),
                question: validation.data.question,
                answer: validation.data.answer,
                category: validation.data.category,
                keywords: validation.data.keywords,
                youtubeLink: validation.data.youtubeLink,
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        return NextResponse.json(newFaq, { status: 201 });
    } catch (error) {
        console.error('Error creating FAQ:', error);
        return NextResponse.json({
            error: 'Failed to create FAQ',
            details: error instanceof Error ? error.message : String(error)
        }, { status: 500 });
    }
}
