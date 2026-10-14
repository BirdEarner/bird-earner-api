import { db } from '@/lib/db';
import { getUserIdFromRequest } from '@/lib/auth';
import { NextResponse } from 'next/server';

// Devices the user has signed in from. Pass ?deviceId= to flag the device making the request.
export async function GET(request: Request) {
    try {
        const userId = await getUserIdFromRequest();
        if (!userId) {
            return NextResponse.json({ success: false, message: 'Unauthorized' }, { status: 401 });
        }

        const currentDeviceId = new URL(request.url).searchParams.get('deviceId');

        const devices = await db
            .selectFrom('userDevices')
            .select(['id', 'deviceId', 'deviceName', 'platform', 'lastLoginAt'])
            .where('userId', '=', userId)
            .orderBy('lastLoginAt', 'desc')
            .execute();

        return NextResponse.json({
            success: true,
            data: devices.map(({ deviceId, ...device }) => ({
                ...device,
                isCurrent: !!currentDeviceId && deviceId === currentDeviceId,
            })),
        });
    } catch (error) {
        console.error('Get user devices error:', error);
        return NextResponse.json({ success: false, message: 'Internal server error' }, { status: 500 });
    }
}
