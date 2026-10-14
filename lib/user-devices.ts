import { db } from '@/lib/db';
import type { DeviceInfo } from '@/lib/two-factor';

// Records (or refreshes) a device the user has signed in from.
// Devices without a deviceId can't be identified later, so they aren't tracked.
export async function recordUserDevice(userId: string, device: DeviceInfo): Promise<void> {
    if (!device.deviceId) return;

    const now = new Date();
    const values = {
        deviceName: device.deviceName ?? null,
        platform: device.platform ?? null,
        lastLoginAt: now,
        updatedAt: now,
    };

    await db
        .insertInto('userDevices')
        .values({
            id: crypto.randomUUID(),
            userId,
            deviceId: device.deviceId,
            ...values,
        })
        .onConflict((oc) => oc.columns(['userId', 'deviceId']).doUpdateSet(values))
        .execute();
}

export async function isKnownUserDevice(userId: string, deviceId: string): Promise<boolean> {
    const device = await db
        .selectFrom('userDevices')
        .select('id')
        .where('userId', '=', userId)
        .where('deviceId', '=', deviceId)
        .executeTakeFirst();

    return !!device;
}
