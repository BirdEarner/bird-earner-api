import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const origin = request.headers.get('origin');
    const allowedOrigin = 'https://birdearner.com';

    // Handle preflight requests
    if (request.method === 'OPTIONS') {
        const response = new NextResponse(null, { status: 204 });

        if (origin === allowedOrigin) {
            response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
        } else {
            // For development or other origins if needed, you could add them here
            // For now, strictly allowing birdearner.com as requested
            response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
        }

        response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        response.headers.set('Access-Control-Max-Age', '86400');

        return response;
    }

    const response = NextResponse.next();

    if (origin === allowedOrigin) {
        response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    } else {
        // Default to allowing the requested origin for now if it's birdearner.com
        response.headers.set('Access-Control-Allow-Origin', allowedOrigin);
    }

    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    return response;
}

export const config = {
    matcher: '/api/:path*',
};
