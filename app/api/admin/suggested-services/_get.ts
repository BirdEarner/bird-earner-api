import { db } from '@/lib/db';
import { getAdminUser } from '@/lib/auth';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
    try {
        const admin = await getAdminUser();
        if (!admin) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get('page') || '1', 10);
        const limit = parseInt(searchParams.get('limit') || '10', 10);
        const status = searchParams.get('status') || 'all';
        const search = searchParams.get('search') || '';

        const offset = (page - 1) * limit;

        // @ts-ignore
        let query = db.selectFrom('suggestedServices as ss')
            .innerJoin('users as u', 'u.id', 'ss.userId')
            .leftJoin('services as s', 's.id', 'ss.matchedServiceId')
            .select([
                'ss.id',
                'ss.userId',
                'ss.serviceName',
                'ss.description',
                'ss.images',
                'ss.status',
                'ss.matchedServiceId',
                'ss.createdAt',
                'ss.updatedAt',
                'u.fullName as userFullName',
                'u.email as userEmail',
                'u.mobile as userMobile',
                's.name as matchedServiceName',
                's.category as matchedServiceCategory',
            ]);

        if (status !== 'all') {
            // @ts-ignore
            query = query.where('ss.status', '=', status);
        }

        if (search) {
            // @ts-ignore
            query = query.where((eb) => eb.or([
                eb('ss.serviceName', 'ilike', `%${search}%`),
                eb('u.fullName', 'ilike', `%${search}%`),
                eb('u.email', 'ilike', `%${search}%`)
            ]));
        }

        // Get total count
        // @ts-ignore
        const countQuery = db.selectFrom('suggestedServices as ss')
            .innerJoin('users as u', 'u.id', 'ss.userId');
        
        let countFiltered = countQuery;
        if (status !== 'all') {
            // @ts-ignore
            countFiltered = countFiltered.where('ss.status', '=', status);
        }
        if (search) {
            // @ts-ignore
            countFiltered = countFiltered.where((eb) => eb.or([
                eb('ss.serviceName', 'ilike', `%${search}%`),
                eb('u.fullName', 'ilike', `%${search}%`),
                eb('u.email', 'ilike', `%${search}%`)
            ]));
        }

        const countResult = await countFiltered
            .select((eb) => eb.fn.count<string>('ss.id').as('count'))
            .executeTakeFirst();

        const totalItems = parseInt(countResult?.count || '0', 10);
        const totalPages = Math.ceil(totalItems / limit);

        const items = await query
            .orderBy('ss.createdAt', 'desc')
            .limit(limit)
            .offset(offset)
            .execute();

        const formattedItems = items.map((item: any) => {
            let parsedImages = [];
            if (item.images) {
                try {
                    parsedImages = typeof item.images === 'string' ? JSON.parse(item.images) : item.images;
                } catch {
                    parsedImages = [];
                }
            }
            return {
                ...item,
                images: parsedImages,
            };
        });

        return NextResponse.json({
            success: true,
            data: {
                suggestions: formattedItems,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems,
                }
            }
        });

    } catch (error: any) {
        console.error('List suggested services error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Internal server error'
        }, { status: 500 });
    }
}
