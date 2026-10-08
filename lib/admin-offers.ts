import { z } from 'zod';

// Admin scratch-card offer (service-specific coupon) validation
export const adminOfferBodySchema = z.object({
    code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,50}$/, 'Coupon code must be 3-50 chars (letters, numbers, - or _)'),
    serviceId: z.string().uuid(),
    amount: z.number().positive(),
    amountType: z.enum(['LUMPSUM', 'PERCENT']),
    minBooking: z.number().min(0).optional(),
    maxDiscount: z.number().positive().nullable().optional(),
    isActive: z.boolean().optional(),
});

export const adminOfferUpdateSchema = adminOfferBodySchema.partial();

export type AdminOfferBody = z.infer<typeof adminOfferBodySchema>;
