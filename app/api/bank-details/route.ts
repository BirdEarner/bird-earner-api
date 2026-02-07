import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const bankAccountSchema = z.object({
    bankName: z.string(),
    accountHolderName: z.string(),
    accountNumber: z.string(),
    ifscCode: z.string(),
});

export async function GET(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const bankAccount = await db
            .selectFrom('bankAccounts')
            .selectAll()
            .where('userId', '=', user.id)
            .executeTakeFirst();

        if (!bankAccount) {
            return NextResponse.json({ success: false, message: 'Bank account not found' });
        }

        return NextResponse.json({
            success: true,
            data: bankAccount
        });
    } catch (error: any) {
        console.error('Get bank detail error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const validation = await validateParams(Promise.resolve(body), bankAccountSchema);

        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const existing = await db
            .selectFrom('bankAccounts')
            .select('id')
            .where('userId', '=', user.id)
            .executeTakeFirst();

        let result;
        if (existing) {
            result = await db
                .updateTable('bankAccounts')
                .set({ ...validation.data, updatedAt: new Date() })
                .where('userId', '=', user.id)
                .returningAll()
                .executeTakeFirstOrThrow();
        } else {
            result = await db
                .insertInto('bankAccounts')
                .values({
                    id: crypto.randomUUID(),
                    userId: user.id,
                    ...validation.data,
                    updatedAt: new Date()
                })
                .returningAll()
                .executeTakeFirstOrThrow();
        }

        return NextResponse.json({
            success: true,
            data: result
        });
    } catch (error: any) {
        console.error('Save bank detail error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        await db
            .deleteFrom('bankAccounts')
            .where('userId', '=', user.id)
            .execute();

        return NextResponse.json({
            success: true,
            message: 'Bank account deleted'
        });
    } catch (error: any) {
        console.error('Delete bank detail error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
