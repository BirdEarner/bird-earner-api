import { OAuth2Client } from 'google-auth-library';
import { upsertOAuthUser } from '@/lib/oauth-user';

function appRedirect(appUrl: string) {
    // Custom-scheme 302 so ASWebAuthenticationSession completes in-app (Guideline 4).
    return new Response(null, {
        status: 302,
        headers: { Location: appUrl },
    });
}

function errorRedirect(_message: string, errorCode: string) {
    return appRedirect(`birdearner://google-auth?error=${encodeURIComponent(errorCode)}`);
}

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
            return errorRedirect('Google sign-in was denied.', error);
        }

        if (!code) {
            return errorRedirect('No authorization code received.', 'no_code');
        }

        const stateRedirectUri = url.searchParams.get('state');
        const backendCallbackUrl = stateRedirectUri || url.origin + '/api/auth/google/callback';

        const oauth2Client = new OAuth2Client(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            backendCallbackUrl
        );

        const { tokens } = await oauth2Client.getToken(code);
        if (!tokens.id_token) {
            return errorRedirect('Failed to get ID token from Google.', 'no_id_token');
        }

        const ticket = await oauth2Client.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        if (!payload || !payload.email) {
            return errorRedirect('Could not verify Google account.', 'invalid_token');
        }

        const result = await upsertOAuthUser({
            provider: 'google',
            providerAccountId: payload.sub,
            email: payload.email,
            fullName: payload.name || null,
            profilePhoto: payload.picture || null,
            emailVerified: !!payload.email_verified,
        });

        if ('error' in result) {
            return errorRedirect(result.error, 'signup_error');
        }

        const encodedData = encodeURIComponent(JSON.stringify(result.data));
        return appRedirect(`birdearner://google-auth?data=${encodedData}`);
    } catch (err) {
        console.error('Google callback error:', err);
        return errorRedirect('Something went wrong. Please try again.', 'server_error');
    }
}
