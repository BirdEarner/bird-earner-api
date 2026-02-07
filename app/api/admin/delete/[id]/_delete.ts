import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const deleteAdminParamsSchema = z.object({
    id: z.string().transform(Number),
});

export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const adminUser = await getAdminUser();
        if (!adminUser || adminUser.role !== 'superadmin') {
            return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        }

        const validation = await validateParams(params, deleteAdminParamsSchema);
        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { id } = validation.data;

        const admin = await db
            .selectFrom('admins')
            .selectAll()
            .where('id', '=', id)
            .executeTakeFirst();

        if (!admin) {
            return NextResponse.json({ message: 'Admin not found' }, { status: 404 });
        }

        await db.deleteFrom('admins').where('id', '=', id).execute();

        return NextResponse.json({ message: 'Admin deleted successfully' });
    } catch (error) {
        console.error('Delete admin error:', error);
        return NextResponse.json({ error: 'Server error' }, { status: 500 });
    }
}
