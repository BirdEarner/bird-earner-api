import { NextResponse } from 'next/server';
import * as mammoth from 'mammoth';

// Word files cannot render natively in browsers (unlike PDFs, which Chrome shows
// after our attachment-url redirect). This route fetches the docx bytes — direct
// delivery works for Office files (only PDF/ZIP are blocked on free plans) — and
// returns a self-contained HTML preview, mirroring the PDF tap flow: tap -> our
// API -> browser shows the document.
const DOC_EXT = /\.(docx?)$/i;

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
    const match = parsed.pathname.match(/^\/([^/]+)\/(image|raw|video)\/upload\/(?:v\d+\/)?(.+)$/);
    const isOwnDoc =
      parsed.hostname === 'res.cloudinary.com' &&
      !!match &&
      match[1] === cloudName &&
      decodeURIComponent(match[3]).startsWith('bird_earner/') &&
      DOC_EXT.test(decodeURIComponent(match[3]));

    if (!isOwnDoc || !cloudName) {
      return NextResponse.json({ error: 'Unsupported url' }, { status: 400 });
    }

    const res = await fetch(rawUrl);
    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch document' }, { status: 502 });
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const fileName = decodeURIComponent(match[3]).split('/').pop() || 'document';

    let bodyHtml = '';
    let fallback = false;
    try {
      const result = await mammoth.convertToHtml({ buffer });
      bodyHtml = result.value;
    } catch {
      // Legacy .doc (binary) isn't supported by mammoth — offer download instead
      fallback = true;
    }

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${fileName.replace(/[<>&"]/g, '')}</title>
<style>
 body{font-family:Arial,Helvetica,sans-serif;margin:0;background:#f5f6f8;color:#1a1a2e}
 header{background:#3B82F6;color:#fff;padding:14px 16px;font-weight:600;word-break:break-all}
 main{max-width:820px;margin:0 auto;padding:20px 16px;background:#fff;min-height:80vh;
      box-shadow:0 1px 4px rgba(0,0,0,.08)}
 main img{max-width:100%}
 p{line-height:1.55}
 .actions{padding:16px;text-align:center}
 .btn{display:inline-block;background:#3B82F6;color:#fff;padding:12px 22px;border-radius:8px;
      text-decoration:none;font-weight:600}
 .note{color:#64748b;font-size:14px;padding:0 16px 16px}
</style></head>
<body>
<header>${fileName.replace(/[<>&"]/g, '')}</header>
${fallback ? `<div class="actions"><a class="btn" href="${rawUrl}">Download to open</a></div>
<div class="note">In-browser preview isn't available for legacy .doc files. Download opens it in your Word app.</div>` : `<main>${bodyHtml || '<p>(This document has no readable text content.)</p>'}</main>`}
</body></html>`;

    return new NextResponse(html, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (error) {
    console.error('[doc-preview] failed:', error);
    return NextResponse.json({ error: 'Failed to render document' }, { status: 500 });
  }
}
