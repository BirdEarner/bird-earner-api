import { z } from 'zod';

export const homePromoBodySchema = z.object({
    placement: z.enum(['BANNER', 'OFFER_CARD']),
    title: z.string().min(1).max(200),
    subtitle: z.string().optional().nullable(),
    badge: z.string().max(50).optional().nullable(),
    ctaLabel: z.string().max(80).optional().nullable(),
    imageUrl: z.string().optional().nullable(),
    backgroundColor: z.string().max(20).optional().nullable(),
    textColor: z.string().max(20).optional().nullable(),
    accentColor: z.string().max(20).optional().nullable(),
    sortOrder: z.union([z.number(), z.string()]).optional().transform((v) => {
        if (v === undefined || v === null || v === '') return 0;
        return typeof v === 'number' ? v : parseInt(String(v), 10) || 0;
    }),
    isActive: z.union([z.boolean(), z.string()]).optional().transform((v) => {
        if (v === undefined) return true;
        if (typeof v === 'boolean') return v;
        return v === 'true' || v === '1';
    }),
    startsAt: z.string().optional().nullable(),
    endsAt: z.string().optional().nullable(),
    serviceId: z.string().uuid().optional().nullable().or(z.literal('')),
    serviceType: z.string().max(20).optional().nullable(),
    prefillJobTitle: z.string().max(200).optional().nullable(),
    prefillJobDescription: z.string().optional().nullable(),
    prefillBudget: z.string().max(40).optional().nullable(),
    prefillJobType: z.string().max(20).optional().nullable(),
    prefillPaymentMethod: z.string().max(20).optional().nullable(),
    prefillSkills: z
        .union([z.array(z.string()), z.string()])
        .optional()
        .nullable()
        .transform((v) => {
            if (v == null || v === '') return null;
            if (Array.isArray(v)) return v;
            try {
                const parsed = JSON.parse(v);
                return Array.isArray(parsed) ? parsed : String(v).split(',').map((s) => s.trim()).filter(Boolean);
            } catch {
                return String(v)
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean);
            }
        }),
});

export function toPromoInsert(data: z.infer<typeof homePromoBodySchema>) {
    const now = new Date();
    return {
        placement: data.placement,
        title: data.title,
        subtitle: data.subtitle || null,
        badge: data.badge || null,
        ctaLabel: data.ctaLabel || null,
        imageUrl: data.imageUrl || null,
        backgroundColor: data.backgroundColor || null,
        textColor: data.textColor || null,
        accentColor: data.accentColor || null,
        sortOrder: data.sortOrder ?? 0,
        isActive: data.isActive ?? true,
        startsAt: data.startsAt ? new Date(data.startsAt) : null,
        endsAt: data.endsAt ? new Date(data.endsAt) : null,
        serviceId: data.serviceId ? data.serviceId : null,
        serviceType: data.serviceType || null,
        prefillJobTitle: data.prefillJobTitle || null,
        prefillJobDescription: data.prefillJobDescription || null,
        prefillBudget: data.prefillBudget || null,
        prefillJobType: data.prefillJobType || null,
        prefillPaymentMethod: data.prefillPaymentMethod || null,
        prefillSkills: data.prefillSkills ?? null,
        updatedAt: now,
    };
}
