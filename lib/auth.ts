import jwt from 'jsonwebtoken';
import { cookies, headers } from 'next/headers';
import { isKnownUserDevice } from '@/lib/user-devices';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

export interface AuthUser {
    id: string;
    email: string;
    role: string;
    // Set on sessions tied to a login device; the session ends when that device is removed
    deviceId?: string;
}

export async function getAuthUser(): Promise<AuthUser | null> {
    try {
        const authHeader = (await headers()).get('authorization');
        const token = authHeader?.startsWith('Bearer ')
            ? authHeader.substring(7)
            : (await cookies()).get('token')?.value;

        if (!token) return null;

        const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;

        // Removing a device from Manage Trusted Devices signs that device out
        if (decoded.deviceId && !(await isKnownUserDevice(decoded.id, decoded.deviceId))) {
            return null;
        }

        return decoded;
    } catch (error) {
        return null;
    }
}

export async function getUserIdFromRequest(request?: Request): Promise<string | null> {
    const user = await getAuthUser();
    return user?.id || null;
}

export async function getAdminUser(request?: Request): Promise<AdminUser | null> {
    try {
        const authHeader = (await headers()).get('authorization');
        const token = authHeader?.startsWith('Bearer ')
            ? authHeader.substring(7)
            : (await cookies()).get('token')?.value;

        if (!token) {
            console.error('[Auth] No token found. Authorization header:', authHeader || 'missing');
            return null;
        }

        const decoded = jwt.verify(token, JWT_SECRET) as AdminUser;

        // Check if it's an admin role
        if (decoded.role !== 'admin' && decoded.role !== 'superadmin') {
            console.error('[Auth] Invalid role:', decoded.role);
            return null;
        }

        return decoded;
    } catch (error: any) {
        console.error('[Auth] JWT verification failed:', error.message);
        return null;
    }
}

export interface AdminUser {
    id: number;
    email: string;
    role: 'admin' | 'superadmin';
}

export function generateToken(user: AuthUser | AdminUser): string {
    return jwt.sign(user, JWT_SECRET, {
        expiresIn: '24h',
    });
}
