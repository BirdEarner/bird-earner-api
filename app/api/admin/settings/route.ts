import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import bcrypt from 'bcryptjs';

export async function PATCH(request: Request) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const body = await request.json();
        const { name, currentPassword, newPassword } = body;

        // If password update is requested
        if (currentPassword && newPassword) {
            const currentAdmin = await db
                .selectFrom('admins')
                .select(['password'])
                .where('id', '=', admin.id)
                .executeTakeFirst();

            if (!currentAdmin || !(await bcrypt.compare(currentPassword, currentAdmin.password))) {
                return NextResponse.json({ message: 'Invalid current password' }, { status: 400 });
            }

            const hashedPassword = await bcrypt.hash(newPassword, 10);
            await db
                .updateTable('admins')
                .set({
                    password: hashedPassword,
                    updatedAt: new Date()
                })
                .where('id', '=', admin.id)
                .execute();
        }

        // Apply other updates
        if (name) {
            await db
                .updateTable('admins')
                .set({
                    name: name,
                    updatedAt: new Date()
                })
                .where('id', '=', admin.id)
                .execute();
        }

        return NextResponse.json({
            success: true,
            message: 'Settings updated successfully'
        });
    } catch (error: any) {
        console.error('Update admin settings error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
