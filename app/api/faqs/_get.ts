import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const faqs = await db
            .selectFrom('faqTable')
            .selectAll()
            .orderBy('id', 'asc')
            .execute();

        return NextResponse.json(faqs);
    } catch (error) {
        console.error('Error fetching FAQs:', error);
        return NextResponse.json({ error: 'Failed to fetch FAQs' }, { status: 500 });
    }
}
