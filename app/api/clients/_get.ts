import { db } from '@/lib/db';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { validateParams } from '@/lib/validation';

const listClientsSchema = z.object({
    page: z.string().optional().default('1').transform(v => parseInt(v)),
    limit: z.string().optional().default('10').transform(v => parseInt(v)),
    companyName: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional()
});

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const params = Object.fromEntries(searchParams.entries());

        const validation = await validateParams(Promise.resolve(params), listClientsSchema);
        if (!validation.success) {
            return NextResponse.json({ message: validation.error }, { status: 400 });
        }

        const { page, limit, companyName, city, state } = validation.data;
        const skip = (page - 1) * limit;

        let query = db
            .selectFrom('clients')
            .selectAll('clients')
            .innerJoin('users', 'users.id', 'clients.userId')
            .select(['users.fullName', 'users.email']);

        // Apply filters
        if (companyName) {
            query = query.where('clients.companyName', 'ilike', `%${companyName}%`);
        }
        if (city) {
            query = query.where('clients.city', 'ilike', `%${city}%`);
        }
        if (state) {
            query = query.where('clients.state', 'ilike', `%${state}%`);
        }

        // Count query
        const totalQuery = db.selectFrom('clients');
        let totalQ = totalQuery.select(({ fn }) => fn.count('id').as('count'));

        if (companyName) totalQ = totalQ.where('companyName', 'ilike', `%${companyName}%`);
        if (city) totalQ = totalQ.where('city', 'ilike', `%${city}%`);
        if (state) totalQ = totalQ.where('state', 'ilike', `%${state}%`);

        const [clients, countResult] = await Promise.all([
            query
                .orderBy('clients.createdAt', 'desc')
                .limit(limit)
                .offset(skip)
                .execute(),
            totalQ.executeTakeFirst()
        ]);

        const total = Number(countResult?.count || 0);

        // Map results to include user object structure expected by frontend
        const mappedClients = clients.map(c => ({
            ...c,
            user: {
                id: c.userId,
                email: c.email,
                fullName: c.fullName
            }
        }));

        return NextResponse.json({
            success: true,
            message: 'Clients retrieved successfully',
            data: {
                clients: mappedClients,
                total,
                page,
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error: any) {
        console.error('List clients error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
