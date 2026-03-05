import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const origin = request.headers.get('origin');

    // Check if the origin matches our allowed domains or is a local development URL
    const isAllowed = origin && (
        origin === 'https://birdearner.com' ||
        origin.startsWith('http://localhost:') ||
        origin.includes('.localhost:')
    );
    // Use the request origin if allowed, otherwise fallback to the production domain
    const corsOrigin = isAllowed ? origin : 'https://birdearner.com';

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
        const response = new NextResponse(null, { status: 204 });

        response.headers.set('Access-Control-Allow-Origin', corsOrigin);
        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        response.headers.set('Access-Control-Allow-Credentials', 'true');
        response.headers.set('Access-Control-Max-Age', '86400');

        return response;
    }

    const response = NextResponse.next();

    response.headers.set('Access-Control-Allow-Origin', corsOrigin);
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.headers.set('Access-Control-Allow-Credentials', 'true');

    return response;
}

export const config = {
    matcher: '/api/:path*',
};
