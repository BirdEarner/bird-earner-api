import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const placement = searchParams.get('placement'); // BANNER | OFFER_CARD | null (all)
        const now = new Date();

        let query = db
            .selectFrom('homePromos')
            .leftJoin('services', 'services.id', 'homePromos.serviceId')
            .selectAll('homePromos')
            .select([
                'services.name as serviceName',
                'services.category as serviceCategory',
            ])
            .where('homePromos.isActive', '=', true)
            .where((eb) =>
                eb.or([
                    eb('homePromos.startsAt', 'is', null),
                    eb('homePromos.startsAt', '<=', now),
                ])
            )
            .where((eb) =>
                eb.or([
                    eb('homePromos.endsAt', 'is', null),
                    eb('homePromos.endsAt', '>=', now),
                ])
            )
            .orderBy('homePromos.sortOrder', 'asc')
            .orderBy('homePromos.createdAt', 'desc');

        if (placement === 'BANNER' || placement === 'OFFER_CARD') {
            query = query.where('homePromos.placement', '=', placement);
        }

        const rows = await query.execute();

        const data = rows.map((row) => ({
            id: row.id,
            placement: row.placement,
            title: row.title,
            subtitle: row.subtitle,
            badge: row.badge,
            ctaLabel: row.ctaLabel,
            imageUrl: row.imageUrl,
            backgroundColor: row.backgroundColor,
            textColor: row.textColor,
            accentColor: row.accentColor,
            sortOrder: row.sortOrder,
            serviceId: row.serviceId,
            serviceType: row.serviceType,
            serviceName: row.serviceName,
            serviceCategory: row.serviceCategory,
            prefillJobTitle: row.prefillJobTitle,
            prefillJobDescription: row.prefillJobDescription,
            prefillBudget: row.prefillBudget,
            prefillJobType: row.prefillJobType,
            prefillPaymentMethod: row.prefillPaymentMethod,
            prefillSkills: row.prefillSkills,
        }));

        return NextResponse.json({
            success: true,
            data: {
                banners: data.filter((d) => d.placement === 'BANNER'),
                offers: data.filter((d) => d.placement === 'OFFER_CARD'),
                all: data,
            },
        });
    } catch (error: unknown) {
        console.error('List home promos error:', error);
        return NextResponse.json(
            {
                success: false,
                message: error instanceof Error ? error.message : 'Server error',
            },
            { status: 500 }
        );
    }
}
