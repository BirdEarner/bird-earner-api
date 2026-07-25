export type AddressRow = {
    id: string;
    userId: string;
    label: string;
    line1: string;
    line2: string | null;
    city: string | null;
    state: string | null;
    zipcode: string | null;
    country: string | null;
    latitude: string | null;
    longitude: string | null;
    isDefault: boolean;
    lastUsedAt: Date | string | null;
    createdAt: Date | string;
    updatedAt: Date | string;
};

export type AddressPayload = {
    id: string;
    label: string;
    line1: string;
    line2: string;
    city: string;
    state: string;
    zipcode: string;
    country: string;
    latitude: number | null;
    longitude: number | null;
    isDefault: boolean;
    lastUsedAt: number | null;
    createdAt: number;
    updatedAt: number;
};

export function serializeAddress(row: AddressRow): AddressPayload {
    return {
        id: row.id,
        label: row.label,
        line1: row.line1,
        line2: row.line2 || '',
        city: row.city || '',
        state: row.state || '',
        zipcode: row.zipcode || '',
        country: row.country || 'India',
        latitude: row.latitude != null ? Number(row.latitude) : null,
        longitude: row.longitude != null ? Number(row.longitude) : null,
        isDefault: Boolean(row.isDefault),
        lastUsedAt: row.lastUsedAt ? new Date(row.lastUsedAt).getTime() : null,
        createdAt: new Date(row.createdAt).getTime(),
        updatedAt: new Date(row.updatedAt).getTime(),
    };
}

export function toDbCoords(value: number | null | undefined) {
    if (value == null || Number.isNaN(Number(value))) return null;
    return String(value);
}
