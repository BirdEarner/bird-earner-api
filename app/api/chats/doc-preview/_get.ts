import { NextResponse } from 'next/server';
import * as mammoth from 'mammoth';

// Word files cannot render natively in browsers (unlike PDFs, which Chrome shows
// after our attachment-url redirect). This route fetches the docx bytes — direct
// delivery works for Office files (only PDF/ZIP are blocked on free plans) — and
// returns a self-contained HTML preview, mirroring the PDF tap flow: tap -> our
// API -> browser shows the document.
const DOC_EXT = /\.(docx?)$/i;

// Watermark drawn over the preview page, same as the PDF pages: "©BIRDEARNER" in grey,
// tilted -35 degrees, on the PDF grid (pitch = page width x 325/864 by x 245/864, text = x 50/864).
// Each copy is a separate text item rather than a repeating background tile, so the
// whole word is never cut off at a tile edge.
const PREVIEW_PAGE_WIDTH = 820;
const PITCH_X = Math.round((PREVIEW_PAGE_WIDTH * 325) / 864);
const PITCH_Y = Math.round((PREVIEW_PAGE_WIDTH * 245) / 864);
const TEXT_PX = Math.round((PREVIEW_PAGE_WIDTH * 50) / 864);
const ROWS = 60; // covers long documents; extra copies beyond the page are simply not visible
const COLUMNS = [-1, 0, 1, 2, 3];

function buildWatermarkItems(): string {
  let items = '';
  for (let row = 0; row < ROWS; row++) {
    for (const col of COLUMNS) {
      const left = col * PITCH_X + (row % 2 === 1 ? PITCH_X / 2 : 0);
      const top = row * PITCH_Y;
      items += `<span style="left:${left}px;top:${top}px">©BIRDEARNER</span>`;
    }
  }
  return `<div class="wm" aria-hidden="true">${items}</div>`;
}
const WATERMARK_HTML = buildWatermarkItems();

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

    // Only watermarked copies (uploaded with "Attach files with watermark", named wm-...) get the overlay
    const isWatermarkedCopy = /^wm-/.test(fileName);

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
 main{position:relative;max-width:820px;margin:0 auto;padding:20px 16px;background:#fff;min-height:80vh;
      box-shadow:0 1px 4px rgba(0,0,0,.08)}
 .content{position:relative;z-index:1}
 .wm{position:absolute;left:0;top:0;right:0;bottom:0;z-index:0;pointer-events:none;overflow:hidden}
 .wm span{position:absolute;white-space:nowrap;font:bold ${TEXT_PX}px Arial,Helvetica,sans-serif;
      color:rgba(217,217,217,.65);transform:rotate(-35deg);transform-origin:0 0}
 main img{max-width:100%}
 p{line-height:1.55}
 .actions{padding:16px;text-align:center}
 .btn{display:inline-block;background:#3B82F6;color:#fff;padding:12px 22px;border-radius:8px;
      text-decoration:none;font-weight:600}
 .note{color:#64748b;font-size:14px;padding:0 16px 16px}
</style></head>
<body>
<header>${fileName.replace(/[<>&"]/g, '')}</header>
${fallback
  ? `<div class="actions"><a class="btn" href="${rawUrl}">Download to open</a></div>
<div class="note">In-browser preview isn't available for legacy .doc files. Download opens it in your Word app.</div>`
  : `<main>${isWatermarkedCopy ? WATERMARK_HTML : ''}<div class="content">${bodyHtml || '<p>(This document has no readable text content.)</p>'}</div></main>`}
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
