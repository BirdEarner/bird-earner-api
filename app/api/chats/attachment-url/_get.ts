import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Free-plan Cloudinary accounts block PDF/ZIP delivery (401 "deny or ACL failure").
// The Admin API download endpoint is NOT subject to that delivery block, so this
// route validates that the requested asset is our own chat media, mints a fresh
// signed download link (timestamp must be fresh - stale signatures are rejected)
// and redirects the browser to it. Redirect keeps the server out of the byte path.
const BLOCKED_EXT = /\.(pdf|zip|rar|7z|gz|tgz|bz2|bzip)$/i;

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rawUrl = searchParams.get('url');
    if (!rawUrl) {
      return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
    }

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    const match = parsed.pathname.match(/^\/([^/]+)\/(image|raw|video)\/upload\/(?:v\d+\/)?(.+)$/);

    const isOwnChatAsset =
      parsed.hostname === 'res.cloudinary.com' &&
      !!match &&
      match[1] === cloudName &&
      match[3].startsWith('bird_earner/') &&
      BLOCKED_EXT.test(decodeURIComponent(match[3]));

    if (!isOwnChatAsset || !cloudName || !apiKey || !apiSecret) {
      return NextResponse.json({ error: 'Unsupported url' }, { status: 400 });
    }

    const resourceType = match[2];
    const pathId = decodeURIComponent(match[3]);
    // Image/video public_ids are stored WITHOUT the format extension (delivery URL
    // appends it); raw public_ids keep their own extension. Try the expected form
    // first, then the other, redirecting on the first success.
    const candidates =
      resourceType === 'image' ? [pathId.replace(BLOCKED_EXT, ''), pathId] : [pathId, pathId.replace(BLOCKED_EXT, '')];

    for (const publicId of candidates) {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = cloudinary.utils.api_sign_request(
        { public_id: publicId, timestamp, type: 'upload' },
        apiSecret
      );
      const signed =
        `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/download` +
        `?public_id=${publicId}&timestamp=${timestamp}&type=upload&api_key=${apiKey}&signature=${signature}`;

      const probe = await fetch(signed);
      if (probe.ok) {
        // drain body so the socket is released
        await probe.arrayBuffer();
        return NextResponse.redirect(signed, 302);
      }
      await probe.arrayBuffer();
    }

    // Signed links failed (unexpected): fall back to the original URL (same host)
    return NextResponse.redirect(rawUrl, 302);
  } catch (error) {
    console.error('[attachment-url] failed:', error);
    return NextResponse.json({ error: 'Failed to sign attachment' }, { status: 500 });
  }
}
