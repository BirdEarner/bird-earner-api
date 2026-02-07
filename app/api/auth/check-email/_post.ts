import { db } from '@/lib/db';
import { validateBody } from '@/lib/validation';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const checkEmailSchema = z.object({
    email: z.string().email(),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = validateBody(body, checkEmailSchema);

        if (!validation.success) {
            return NextResponse.json({ success: false, message: validation.error }, { status: 400 });
        }

        const { email } = validation.data;

        const user = await db
            .selectFrom('users')
            .select('id')
            .where('email', '=', email)
            .executeTakeFirst();

        return NextResponse.json({ success: true, exists: !!user });
    } catch (error) {
        console.error('Check email error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
