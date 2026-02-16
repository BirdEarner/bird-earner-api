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

        const { question, history = [] } = validation.data;
        const chatHistory = history.map((msg, i) => ({
            role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
            content: msg,
        }));

        // Step 1: Initial classification/search query generation
        const initialCompletion = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system' as const,
                    content: `You are a helpful assistant for an app named BirdEarner. Follow these rules strictly:
1. If the question is a general greeting or unrelated to the app (e.g., "Hi", "How are you?"), answer directly starting with "Answer:".
2. If the question is related to BirdEarner (jobs, freelancers, earnings, profiles, etc.), respond ONLY with "Search Query:" followed by 3-5 specific, relevant keywords.
3. Keep the search query concise and focused on the core intent of the question.`,
                },
                ...chatHistory,
                { role: 'user' as const, content: `User question: "${question}"` },
            ],
            model: 'llama-3.1-8b-instant',
            temperature: 0.3,
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
            .select(['id', 'question', 'keywords', 'answer'])
            .execute();

        const fuse = new Fuse(allFaqs, {
            keys: [
                { name: 'question', weight: 0.5 },
                { name: 'keywords', weight: 0.3 },
                { name: 'answer', weight: 0.2 }
            ],
            threshold: 0.5, // Slightly more lenient
            distance: 100,
            ignoreLocation: true,
        });

        const topResults = fuse.search(refinedQuery).slice(0, 5).map(res => res.item);

        if (topResults.length === 0) {
            return NextResponse.json({ answer: 'No relevant answers found in the database.' });
        }

        // Step 3: Select best answer
        const context = topResults.map(faq => `ID: ${faq.id}, Question: ${faq.question}, Answer Snippet: ${faq.answer.substring(0, 100)}...`).join('\n\n');
        const selection = await groq.chat.completions.create({
            messages: [
                {
                    role: 'system' as const,
                    content: "You're a helpful assistant. Choose the BEST matching ID from the list for the user's question. If none of them are a good match, respond with '0'. Only reply with the ID number.",
                },
                ...chatHistory,
                {
                    role: 'user' as const,
                    content: `User question: "${question}"\n\nPotential Answers:\n${context}`,
                },
            ],
            model: 'llama-3.1-8b-instant',
            temperature: 0.1, // Lower temperature for more consistent selection
        });

        const selectedIdMatch = selection.choices[0]?.message?.content?.trim();
        const selectedId = selectedIdMatch || null;

        if (!selectedId || selectedId === '0') {
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
            model: 'llama-3.1-8b-instant',
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
