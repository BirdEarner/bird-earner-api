import { OAuth2Client } from 'google-auth-library';
import { db } from '@/lib/db';
import { generateToken } from '@/lib/auth';

function redirectPage(appUrl: string, error?: string) {
    const displayMessage = error
        ? `<p style="margin: 0; opacity: 0.8; font-size: 14px; color: #ff6b6b;">${error}</p>`
        : `<p style="margin: 0; opacity: 0.8; font-size: 14px;">Redirecting you back to Bird Earner app.</p>`;

    const html = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Bird Earner Sign In</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex; align-items: center; justify-content: center;
            height: 100vh; margin: 0; background: #4B0082; color: #ffffff; text-align: center;
        }
        .card {
            background: rgba(255,255,255,0.1); backdrop-filter: blur(10px);
            padding: 32px; border-radius: 20px; border: 1px solid rgba(255,255,255,0.2);
            box-shadow: 0 10px 30px rgba(0,0,0,0.3); max-width: 320px; width: 90%;
        }
        .spinner {
            margin: 20px auto; width: 40px; height: 40px;
            border: 4px solid rgba(255,255,255,0.3); border-top-color: #ffffff;
            border-radius: 50%; animation: spin 0.8s linear infinite;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="card">
        <div class="spinner"></div>
        <h2 style="margin: 0 0 10px 0; font-size: 20px;">Signing in...</h2>
        ${displayMessage}
    </div>
    <script>
        (function() {
            var appUrl = ${JSON.stringify(appUrl)};
            window.location.href = appUrl;
            setTimeout(function() { window.location.href = appUrl; }, 500);
        })();
    </script>
</body>
</html>`;
    return html;
}

export async function GET(request: Request) {
    try {
        const url = new URL(request.url);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');

        if (error) {
            const html = redirectPage('birdearner://google-auth?error=' + encodeURIComponent(error), 'Google sign-in was denied.');
            return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        if (!code) {
            const html = redirectPage('birdearner://google-auth?error=no_code', 'No authorization code received.');
            return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        const stateRedirectUri = url.searchParams.get('state');
        const backendCallbackUrl = stateRedirectUri || (url.origin + '/api/auth/google/callback');

        const oauth2Client = new OAuth2Client(
            process.env.GOOGLE_CLIENT_ID,
            process.env.GOOGLE_CLIENT_SECRET,
            backendCallbackUrl,
        );

        const { tokens } = await oauth2Client.getToken(code);
        if (!tokens.id_token) {
            const html = redirectPage('birdearner://google-auth?error=no_id_token', 'Failed to get ID token from Google.');
            return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        const ticket = await oauth2Client.verifyIdToken({
            idToken: tokens.id_token,
            audience: process.env.GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        if (!payload || !payload.email) {
            const html = redirectPage('birdearner://google-auth?error=invalid_token', 'Could not verify Google account.');
            return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
        }

        const googleEmail = payload.email.toLowerCase();
        const googleId = payload.sub;
        const fullName = payload.name || '';
        const emailVerified = payload.email_verified || false;

        let existingUser = await db
            .selectFrom('users')
            .selectAll()
            .where('email', '=', googleEmail)
            .executeTakeFirst();

        let isNewUser = false;

        if (existingUser) {
            if (existingUser.provider === 'email' && !existingUser.providerAccountId) {
                await db
                    .updateTable('users')
                    .set({
                        providerAccountId: googleId,
                        isEmailVerified: emailVerified ? true : existingUser.isEmailVerified,
                        updatedAt: new Date(),
                    })
                    .where('id', '=', existingUser.id)
                    .execute();
            }
        } else {
            isNewUser = true;
            const userId = crypto.randomUUID();
            const result = await db
                .insertInto('users')
                .values({
                    id: userId,
                    email: googleEmail,
                    password: null,
                    fullName: fullName,
                    provider: 'google',
                    providerAccountId: googleId,
                    isEmailVerified: emailVerified,
                    updatedAt: new Date(),
                })
                .returningAll()
                .executeTakeFirstOrThrow();

            existingUser = result;
        }

        const freelancerProfile = await db
            .selectFrom('freelancers')
            .select('id')
            .where('userId', '=', existingUser.id)
            .executeTakeFirst();

        const clientProfile = await db
            .selectFrom('clients')
            .select('id')
            .where('userId', '=', existingUser.id)
            .executeTakeFirst();

        const role = freelancerProfile
            ? 'FREELANCER'
            : clientProfile
            ? 'CLIENT'
            : 'USER';

        const token = generateToken({
            id: existingUser.id,
            email: existingUser.email,
            role,
        });

        const { password: _, ...userWithoutPassword } = existingUser;

        const fullFreelancerProfile = await db
            .selectFrom('freelancers')
            .selectAll()
            .where('userId', '=', existingUser.id)
            .executeTakeFirst();

        const fullClientProfile = await db
            .selectFrom('clients')
            .selectAll()
            .where('userId', '=', existingUser.id)
            .executeTakeFirst();

        const userData = {
            ...userWithoutPassword,
            role,
            isNewUser,
            ...(fullFreelancerProfile ? { freelancer: fullFreelancerProfile } : {}),
            ...(fullClientProfile ? { client: fullClientProfile } : {}),
            token,
        };

        const encodedData = encodeURIComponent(JSON.stringify(userData));
        const appUrl = `birdearner://google-auth?data=${encodedData}`;

        const html = redirectPage(appUrl);
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    } catch (err) {
        console.error('Google callback error:', err);
        const html = redirectPage('birdearner://google-auth?error=server_error', 'Something went wrong. Please try again.');
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
    }
}
