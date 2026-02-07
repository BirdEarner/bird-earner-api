import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import Fuse from 'fuse.js';
import Groq from 'groq-sdk';

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const aiFaqSchema = z.object({
    question: z.string().min(1, 'Question is required'),
    history: z.array(z.string()).optional().default([]),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, aiFaqSchema);

        if (!validation.success) {
            return NextResponse.json({ error: validation.error }, { status: 400 });
        }

        const { question, history } = validation.data;
        const chatHistory = history.map((msg, i) => ({
            role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
            content: msg,
        }));

        // Step 1: Initial classification/search query generation
        const initialCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system' as const,
                    content: `You are a helpful assistant for an app named BirdEarner. Your job is to answer questions on behalf of the user. Follow these rules strictly:
          1. If the question is simple and unrelated to the app (e.g., general knowledge), answer directly starting with "Answer:".
          2. If the question is related to the app (e.g., job postings, freelancers, clients), start your response with "Search Query:" followed by relevant keywords.
          3. Do not answer app-related questions directly. Always use the database for app-related queries.`,
                },
                ...chatHistory,
                { role: 'user' as const, content: `User question: "${question}"` },
            ],
            model: 'llama3-8b-8192',
            temperature: 0.5,
        });

        const groqResponse = initialCompletion.choices[0]?.message?.content?.trim();

        if (!groqResponse) {
            return NextResponse.json({ error: 'The assistant could not process the request.' }, { status: 500 });
        }

        if (groqResponse.startsWith('Answer:')) {
            return NextResponse.json({ answer: groqResponse.replace('Answer:', '').trim() });
        }

        if (!groqResponse.startsWith('Search Query:')) {
            return NextResponse.json({ error: 'Invalid assistant response format.' }, { status: 500 });
        }

        const refinedQuery = `${question} ${groqResponse.replace('Search Query:', '').trim()}`;

        // Step 2: Database Search
        const allFaqs = await db.selectFrom('faqTable')
            .select(['id', 'question', 'keywords'])
            .execute();

        const fuse = new Fuse(allFaqs, {
            keys: ['question', 'keywords'],
            threshold: 0.4,
        });

        const topResults = fuse.search(refinedQuery).slice(0, 5).map(res => res.item);

        if (topResults.length === 0) {
            return NextResponse.json({ answer: 'No relevant answers found in the database.' });
        }

        // Step 3: Select best answer
        const context = topResults.map(faq => `ID: ${faq.id}, Question: ${faq.question}`).join('\n');
        const selection = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system' as const,
                    content: "You're a helpful assistant. Choose the best matching ID from the list for the user's question. Only reply with the number.",
                },
                ...chatHistory,
                {
                    role: 'user' as const,
                    content: `User question: "${question}"\n\nAvailable:\n${context}`,
                },
            ],
            model: 'llama3-8b-8192',
            temperature: 0.5,
        });

        const selectedIdMatch = selection.choices[0]?.message?.content?.match(/\d+/);
        const selectedId = selectedIdMatch ? parseInt(selectedIdMatch[0], 10) : null;

        if (!selectedId) {
            return NextResponse.json({ error: 'The assistant could not determine a suitable answer.' }, { status: 500 });
        }

        const selectedFaq = await db.selectFrom('faqTable')
            .select('answer')
            .where('id', '=', selectedId)
            .executeTakeFirst();

        if (!selectedFaq) {
            return NextResponse.json({ error: 'Answer for selected ID could not be found.' }, { status: 500 });
        }

        // Step 4: Restructure answer
        const restructure = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system' as const,
                    content: 'Restructure the answer to suit the original question. Return only the improved answer, wrapped in double quotes.',
                },
                ...chatHistory,
                {
                    role: 'user' as const,
                    content: `User question: "${question}"\nSelected answer: "${selectedFaq.answer}"`,
                },
            ],
            model: 'llama3-8b-8192',
            temperature: 0.5,
        });

        const finalAnswerText = restructure.choices[0]?.message?.content?.trim();
        const finalAnswerMatch = finalAnswerText?.match(/"(.*)"/s);
        const finalAnswer = finalAnswerMatch ? finalAnswerMatch[1].trim() : selectedFaq.answer;

        return NextResponse.json({ answer: finalAnswer });
    } catch (error) {
        console.error('AI FAQ Error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
