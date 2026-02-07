import jwt from 'jsonwebtoken';
import { cookies, headers } from 'next/headers';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

export interface AuthUser {
    id: string;
    email: string;
    role: string;
}

export async function getAuthUser(): Promise<AuthUser | null> {
    try {
        const authHeader = (await headers()).get('authorization');
        const token = authHeader?.startsWith('Bearer ')
            ? authHeader.substring(7)
            : (await cookies()).get('token')?.value;

        if (!token) return null;

        const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
        return decoded;
    } catch (error) {
        return null;
    }
}

export async function getUserIdFromRequest(): Promise<string | null> {
    const user = await getAuthUser();
    return user?.id || null;
}

export async function getAdminUser(): Promise<AdminUser | null> {
    try {
        const authHeader = (await headers()).get('authorization');
        const token = authHeader?.startsWith('Bearer ')
            ? authHeader.substring(7)
            : (await cookies()).get('token')?.value;

        if (!token) return null;

        const decoded = jwt.verify(token, JWT_SECRET) as AdminUser;

        // Check if it's an admin role
        if (decoded.role !== 'admin' && decoded.role !== 'superadmin') return null;

        return decoded;
    } catch (error) {
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
