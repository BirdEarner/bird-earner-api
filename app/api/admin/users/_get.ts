import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET() {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ message: 'Forbidden' }, { status: 403 });
        }

        // Fetch clients
        const clients = await db
            .selectFrom('clients')
            .innerJoin('users', 'users.id', 'clients.userId')
            .select(['clients.id', 'users.fullName', 'users.email', 'clients.userId'])
            .execute();

        // Fetch freelancers
        const freelancers = await db
            .selectFrom('freelancers')
            .innerJoin('users', 'users.id', 'freelancers.userId')
            .select(['freelancers.id', 'users.fullName', 'users.email', 'freelancers.userId'])
            .execute();

        const formattedClients = clients.map(c => ({
            id: c.userId, // Use userId for notification targeting
            name: c.fullName,
            email: c.email,
            type: 'client'
        }));

        const formattedFreelancers = freelancers.map(f => ({
            id: f.userId, // Use userId for notification targeting
            name: f.fullName,
            email: f.email,
            type: 'freelancer'
        }));

        return NextResponse.json({
            users: [...formattedClients, ...formattedFreelancers]
        });

    } catch (error: any) {
        console.error('List users for admin error:', error);
        return NextResponse.json({ message: error.message || 'Server error' }, { status: 500 });
    }
}
