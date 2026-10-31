import { getAdminUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';

const notesSchema = z.object({
    notes: z.string().max(10000, 'Notes must be 10,000 characters or less'),
});

/** Save internal admin notes on a contact / support / report ticket. */
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;
        if (!id) {
            return NextResponse.json({ success: false, message: 'Contact ID is required' }, { status: 400 });
        }

        const body = await request.json().catch(() => null);
        const parsed = notesSchema.safeParse(body);
        if (!parsed.success) {
            return NextResponse.json(
                {
                    success: false,
                    message: parsed.error.issues[0]?.message || 'Invalid notes',
                },
                { status: 400 }
            );
        }

        const notes = parsed.data.notes.trim() || null;

        const updated = await db
            .updateTable('contacts')
            .set({
                adminResponse: notes,
                adminId: admin.id,
                updatedAt: new Date(),
            })
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirst();

        if (!updated) {
            return NextResponse.json({ success: false, message: 'Contact not found' }, { status: 404 });
        }

        return NextResponse.json({
            success: true,
            message: 'Admin notes saved',
            data: updated,
        });
    } catch (error: any) {
        console.error('Save contact notes error:', error);
        return NextResponse.json(
            { success: false, message: error.message || 'Server error' },
            { status: 500 }
        );
    }
}
