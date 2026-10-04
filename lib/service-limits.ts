import { db } from '@/lib/db';

export type FreelancerWorkType = 'remote' | 'onsite';

// selectedServices may be stored as a JSON string or an array; 'suggested:*'
// tokens are not real services and never count toward per-type limits.
export function parseSelectedServices(raw: any): string[] {
    if (Array.isArray(raw)) return raw.filter((v): v is string => typeof v === 'string');
    if (typeof raw === 'string' && raw) {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [raw];
        } catch {
            return [raw];
        }
    }
    return [];
}

function serviceWorkTypeOf(category: any): FreelancerWorkType {
    return category === 'HOUSEHOLD' ? 'onsite' : 'remote';
}

// Per-type service limits (Part 3):
// - current workType: min 1, max 5 (a suggested service counts toward the current type)
// - each type independently capped at 5
// - services of the other type are never touched, only counted
export async function validatePerTypeServiceLimits(
    selectedIds: any,
    workType: FreelancerWorkType | null | undefined,
    hasSuggested: boolean
): Promise<string | null> {
    const ids = parseSelectedServices(selectedIds).filter((id) => !id.startsWith('suggested:'));

    let remoteCount = 0;
    let onsiteCount = 0;
    if (ids.length > 0) {
        const rows = await db
            .selectFrom('services')
            .select(['id', 'category'])
            .where('id', 'in', ids)
            .execute();
        const onsiteIds = new Set(rows.filter((r) => serviceWorkTypeOf(r.category) === 'onsite').map((r) => r.id));
        for (const id of ids) {
            if (onsiteIds.has(id)) onsiteCount++;
            else remoteCount++; // FREELANCE or unknown/legacy id -> remote (matches app taxonomy)
        }
    }

    if (remoteCount > 5) return 'You can select a maximum of 5 remote services.';
    if (onsiteCount > 5) return 'You can select a maximum of 5 on-site services.';

    const suggested = hasSuggested ? 1 : 0;
    const current = workType === 'remote' ? remoteCount
        : workType === 'onsite' ? onsiteCount
        : remoteCount + onsiteCount;

    if (current + suggested < 1) {
        if (workType === 'remote') return 'Please select at least 1 remote service or suggest a service.';
        if (workType === 'onsite') return 'Please select at least 1 on-site service or suggest a service.';
        return 'Please select at least 1 service or suggest a service.';
    }
    if (current + suggested > 5) {
        if (workType === 'remote') return 'You can select a maximum of 5 remote services.';
        if (workType === 'onsite') return 'You can select a maximum of 5 on-site services.';
        return 'You can select a maximum of 5 services.';
    }
    return null;
}
