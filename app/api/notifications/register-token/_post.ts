import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const tokenSchema = z.object({
    userId: z.string(),
    userType: z.string().optional(),
    token: z.string(),
    platform: z.string().optional(),
});

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), tokenSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { userId, userType, token, platform } = validation.data;

        const existingToken = await db
            .selectFrom('pushTokens')
            .select('id')
            .where('token', '=', token)
            .executeTakeFirst();

        if (existingToken) {
            await db
                .updateTable('pushTokens')
                .set({
                    userId,
                    userType: userType || 'USER',
                    platform: platform || 'android',
                    isActive: true,
                    updatedAt: new Date()
                })
                .where('token', '=', token)
                .execute();

            return NextResponse.json({ message: "Token refreshed" });
        }

        await db
            .insertInto('pushTokens')
            .values({
                id: crypto.randomUUID(),
                userId,
                userType: userType || 'USER',
                token,
                platform: platform || 'android',
                isActive: true,
                updatedAt: new Date()
            })
            .execute();

        return NextResponse.json({ message: "Token registered" }, { status: 201 });
    } catch (error: any) {
        console.error('Register token error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
