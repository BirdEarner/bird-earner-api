import JSZip from 'jszip';

/**
 * Adds a tiled "©BIRDEARNER" watermark to every page of a Word (.docx) document.
 *
 * A .docx is a zip of XML parts. The watermark is placed in the page headers, which Word
 * repeats on every page: each section gets a default header (and a first-page header when
 * "different first page" is set) that holds the watermark shapes. Existing headers keep
 * their content and only get the watermark shapes added.
 *
 * The grid uses the same proportions as the PDF and image watermarks.
 */

const DEFAULT_PAGE_TWIPS = { w: 12240, h: 15840 }; // US Letter
const TWIPS_PER_PT = 20;

const SHAPETYPE_136 = `<v:shapetype id="_x0000_t136" coordsize="21600,21600" o:spt="136" adj="10800" path="m@7,l@8,m@5,21600l@6,21600e"><v:formulas><v:f eqn="sum #0 0 10800"/><v:f eqn="prod #0 2 1"/><v:f eqn="sum 21600 0 @1"/><v:f eqn="sum 0 0 @2"/><v:f eqn="sum 21600 0 @3"/><v:f eqn="if @0 @3 0"/><v:f eqn="if @0 21600 @1"/><v:f eqn="if @0 0 @2"/><v:f eqn="if @0 @4 21600"/><v:f eqn="mid @5 @6"/><v:f eqn="mid @8 @5"/><v:f eqn="mid @7 @8"/><v:f eqn="mid @6 @7"/><v:f eqn="sum @6 0 @5"/></v:formulas><v:path textpathok="t" o:connecttype="custom" o:connectlocs="@9,0;@10,10800;@11,21600;@12,10800" o:connectangles="270,180,90,0"/><v:textpath on="t" fitshape="t"/><v:handles><v:h position="#0,bottomRight" xrange="6629,14971"/></v:handles><o:lock v:ext="edit" text="t" shapetype="t"/></v:shapetype>`;

const HEADER_NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ' +
  'xmlns:v="urn:schemas-microsoft-com:vml" ' +
  'xmlns:o="urn:schemas-microsoft-com:office:office" ' +
  'xmlns:w10="urn:schemas-microsoft-com:office:word"';

const HEADER_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml';
const HEADER_REL_TYPE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header';

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Tiled watermark shapes for one page size (in points), using the image/PDF proportions. */
function buildWatermarkRun(pageWidthPt: number, pageHeightPt: number, text: string, partId: number): string {
  const width = pageWidthPt;
  const height = pageHeightPt;
  const stepX = width * (325 / 864);
  const stepY = width * (245 / 864);
  const fontPt = width * (50 / 864);
  const shapeWidth = fontPt * 7.5;
  const shapeHeight = fontPt * 1.6;
  const label = escapeXml(text);

  let shapes = '';
  let index = 0;
  for (let y = -stepY; y < height + stepY; y += stepY) {
    for (let x = -stepX; x < width + stepX; x += stepX) {
      const id = `WM${partId}_${index}`;
      const spid = 2100 + partId * 100 + index;
      shapes +=
        `<v:shape id="${id}" o:spid="_x0000_s${spid}" type="#_x0000_t136" ` +
        `style="position:absolute;margin-left:${x.toFixed(1)}pt;margin-top:${y.toFixed(1)}pt;` +
        `width:${shapeWidth.toFixed(1)}pt;height:${shapeHeight.toFixed(1)}pt;rotation:325;z-index:-251657216;` +
        `mso-position-horizontal-relative:page;mso-position-vertical-relative:page" ` +
        `o:allowincell="f" fillcolor="#D9D9D9" stroked="f">` +
        `<v:fill opacity=".65"/>` +
        `<v:textpath style="font-family:&quot;Arial&quot;;font-size:${fontPt.toFixed(1)}pt;font-weight:bold" string="${label}"/>` +
        `<w10:wrap anchorx="page" anchory="page"/></v:shape>`;
      index++;
    }
  }
  return `<w:p><w:r><w:rPr><w:noProof/></w:rPr><w:pict>${SHAPETYPE_136}${shapes}</w:pict></w:r></w:p>`;
}

function buildHeaderPart(run: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr ${HEADER_NS}>${run}</w:hdr>`;
}

/** Makes sure an existing header root declares the VML namespaces the watermark needs. */
function ensureHeaderNamespaces(xml: string): string {
  return xml.replace(/<w:hdr\b([^>]*)>/, (whole, attrs: string) => {
    let extra = '';
    for (const decl of ['xmlns:v="urn:schemas-microsoft-com:vml"', 'xmlns:o="urn:schemas-microsoft-com:office:office"', 'xmlns:w10="urn:schemas-microsoft-com:office:word"']) {
      const name = decl.split('=')[0];
      if (!attrs.includes(`${name}=`)) extra += ` ${decl}`;
    }
    return `<w:hdr${attrs}${extra}>`;
  });
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
}

function pageSizePt(sectPr: string): { w: number; h: number } {
  const pgSz = sectPr.match(/<w:pgSz\b[^>]*\/?>/);
  const w = Number(pgSz ? attr(pgSz[0], 'w:w') : null) || DEFAULT_PAGE_TWIPS.w;
  const h = Number(pgSz ? attr(pgSz[0], 'w:h') : null) || DEFAULT_PAGE_TWIPS.h;
  return { w: w / TWIPS_PER_PT, h: h / TWIPS_PER_PT };
}

function parseRelationships(relsXml: string): Map<string, { type: string; target: string }> {
  const map = new Map<string, { type: string; target: string }>();
  for (const rel of relsXml.match(/<Relationship\b[^>]*\/?>/g) || []) {
    const id = attr(rel, 'Id');
    const target = attr(rel, 'Target');
    if (id && target) map.set(id, { type: attr(rel, 'Type') || '', target });
  }
  return map;
}

export async function watermarkDocxBuffer(input: Buffer, watermarkText: string = '©BIRDEARNER'): Promise<Buffer> {
  try {
    const zip = await JSZip.loadAsync(input);
    const docFile = zip.file('word/document.xml');
    if (!docFile) return input;

    let documentXml = await docFile.async('string');
    const relsPath = 'word/_rels/document.xml.rels';
    const relsFile = zip.file(relsPath);
    let relsXml = relsFile
      ? await relsFile.async('string')
      : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    const relationships = parseRelationships(relsXml);

    // Load the header parts that already exist so their content can be kept
    const headers = new Map<string, string>();
    for (const rel of relationships.values()) {
      if (rel.type === HEADER_REL_TYPE) {
        const path = `word/${rel.target}`;
        const file = zip.file(path);
        if (file) headers.set(path, await file.async('string'));
      }
    }

    const settingsFile = zip.file('word/settings.xml');
    const settingsXml = settingsFile ? await settingsFile.async('string') : '';
    const evenAndOdd = /<w:evenAndOddHeaders\b(?![^>]*w:val="(0|false)")/.test(settingsXml);

    const contentTypesFile = zip.file('[Content_Types].xml');
    let contentTypesXml = contentTypesFile ? await contentTypesFile.async('string') : '';

    const newParts: { path: string; xml: string }[] = [];
    const newRelationships: string[] = [];
    const injected = new Set<string>();
    let partCounter = 0;
    let groupCounter = 0;

    const injectInto = (path: string, run: string) => {
      if (injected.has(path)) return;
      injected.add(path);
      const current = headers.get(path) ?? '';
      const withNs = ensureHeaderNamespaces(current);
      headers.set(path, withNs.replace(/<\/w:hdr>\s*$/, `${run}</w:hdr>`));
    };

    const newHeaderFor = (run: string): string => {
      partCounter++;
      const n = partCounter;
      const path = `word/watermark-header${n}.xml`;
      const rid = `rIdWm${n}`;
      newParts.push({ path, xml: buildHeaderPart(run) });
      newRelationships.push(`<Relationship Id="${rid}" Type="${HEADER_REL_TYPE}" Target="watermark-header${n}.xml"/>`);
      return rid;
    };

    documentXml = documentXml.replace(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g, (sectPr) => {
      const page = pageSizePt(sectPr);
      const existing = [...sectPr.matchAll(/<w:headerReference\b[^>]*\/?>/g)].map((m) => ({
        type: attr(m[0], 'w:type'),
        rid: attr(m[0], 'r:id'),
      }));

      const wanted = ['default'];
      if (/<w:titlePg\b(?![^>]*w:val="(0|false)")/.test(sectPr)) wanted.push('first');
      if (evenAndOdd) wanted.push('even');

      let addedRefs = '';
      for (const type of wanted) {
        const found = existing.find((e) => e.type === type && e.rid);
        const target = found ? relationships.get(found.rid as string) : undefined;
        if (found && target && target.type === HEADER_REL_TYPE) {
          groupCounter++;
          injectInto(`word/${target.target}`, buildWatermarkRun(page.w, page.h, watermarkText, groupCounter));
        } else if (!found) {
          groupCounter++;
          const rid = newHeaderFor(buildWatermarkRun(page.w, page.h, watermarkText, groupCounter));
          addedRefs += `<w:headerReference w:type="${type}" r:id="${rid}"/>`;
        }
      }
      return addedRefs ? sectPr.replace(/^(<w:sectPr\b[^>]*>)/, `$1${addedRefs}`) : sectPr;
    });

    // Write everything back
    zip.file('word/document.xml', documentXml);
    for (const [path, xml] of headers) zip.file(path, xml);

    for (const part of newParts) {
      zip.file(part.path, part.xml);
      contentTypesXml = contentTypesXml.replace(
        '</Types>',
        `<Override PartName="/${part.path}" ContentType="${HEADER_CONTENT_TYPE}"/></Types>`
      );
    }
    if (newRelationships.length > 0) {
      relsXml = relsXml.replace('</Relationships>', `${newRelationships.join('')}</Relationships>`);
      zip.file(relsPath, relsXml);
    }
    if (contentTypesFile && newParts.length > 0) zip.file('[Content_Types].xml', contentTypesXml);

    return Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
  } catch (error) {
    console.error('DOCX watermarking error:', error);
    return input; // Keep the original if the file is not a readable Word document
  }
}
