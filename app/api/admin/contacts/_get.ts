import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { sql } from 'kysely';

function normalizePhone(value?: string | null) {
    const trimmed = String(value || '').trim();
    return trimmed || null;
}

export async function GET(request: Request) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const page = Number(searchParams.get('page')) || 1;
        const pageSize = Number(searchParams.get('pageSize')) || 50;
        const status = searchParams.get('status');

        const query = db.selectFrom('contacts').selectAll();
        const totalQuery = db.selectFrom('contacts');

        const filterQuery = (qb: any) => {
            if (status) {
                return qb.where('status', '=', status as any);
            }
            return qb;
        };

        const [totalResult, contacts] = await Promise.all([
            filterQuery(totalQuery)
                .select(sql<number>`count(*)`.as('count'))
                .executeTakeFirst(),
            filterQuery(query)
                .orderBy('createdAt', 'desc')
                .offset((page - 1) * pageSize)
                .limit(pageSize)
                .execute(),
        ]);

        // Fall back to the matching user's mobile when contact.phone was never stored
        const emails = [
            ...new Set(
                contacts
                    .map((c) => String(c.email || '').trim().toLowerCase())
                    .filter(Boolean)
            ),
        ];

        const mobileByEmail = new Map<string, string>();
        if (emails.length > 0) {
            const users = await db
                .selectFrom('users')
                .select(['email', 'mobile'])
                .where(sql`lower(email)`, 'in', emails)
                .execute();

            for (const user of users) {
                const key = String(user.email || '')
                    .trim()
                    .toLowerCase();
                const mobile = normalizePhone(user.mobile);
                if (key && mobile && !mobileByEmail.has(key)) {
                    mobileByEmail.set(key, mobile);
                }
            }
        }

        const enrichedContacts = contacts.map((contact) => {
            const phone =
                normalizePhone(contact.phone) ||
                mobileByEmail.get(String(contact.email || '').trim().toLowerCase()) ||
                null;
            return { ...contact, phone };
        });

        return NextResponse.json({
            success: true,
            data: {
                contacts: enrichedContacts,
                total: Number(totalResult?.count || 0),
                page,
                totalPages: Math.ceil(Number(totalResult?.count || 0) / pageSize),
            },
        });
    } catch (error: any) {
        console.error('Get contacts error:', error);
        return NextResponse.json(
            {
                success: false,
                message: error.message || 'Server error',
            },
            { status: 500 }
        );
    }
}
