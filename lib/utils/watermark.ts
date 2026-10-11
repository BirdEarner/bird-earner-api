import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';

/**
 * Tile the semi-transparent "©BIRDEARNER" text diagonally (-35°) across every page of a PDF,
 * using the same proportions as the image watermark.
 */
export async function watermarkPdfBuffer(inputBuffer: Buffer, watermarkText: string = '©BIRDEARNER'): Promise<Buffer> {
  try {
    const pdfDoc = await PDFDocument.load(inputBuffer, { ignoreEncryption: true });
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pages = pdfDoc.getPages();

    for (const page of pages) {
      const { width, height } = page.getSize();
      // Image watermark proportions relative to width (50px text, 325 x 245px pitch on an 864px image)
      const fontSize = width * (50 / 864);
      const stepX = width * (325 / 864);
      const stepY = width * (245 / 864);

      for (let y = -stepY; y < height + stepY; y += stepY) {
        for (let x = -stepX; x < width + stepX; x += stepX) {
          page.drawText(watermarkText, {
            x: x,
            y: y,
            size: fontSize,
            font: font,
            color: rgb(0.85, 0.85, 0.85),
            opacity: 0.65,
            rotate: degrees(-35),
          });
        }
      }
    }

    const watermarkedBytes = await pdfDoc.save();
    return Buffer.from(watermarkedBytes);
  } catch (error) {
    console.error('PDF watermarking error:', error);
    return inputBuffer; // Return original buffer if not a standard PDF
  }
}

/**
 * Video watermark artwork: a transparent SVG with ©BIRDEARNER tiled diagonally across the
 * whole frame, the same look as the image watermark. Cloudinary's own tiled overlay repeats
 * only once on video, so the tiles are drawn here and uploaded as an overlay image.
 */
export function buildVideoWatermarkSvg(width: number, height: number, watermarkText: string = '©BIRDEARNER'): string {
  const text = (watermarkText || '©BIRDEARNER')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  // Same tile lattice as the image watermark: 50px bold text, 325 x 245px pitch, rotated -35deg
  const colStep = 325;
  const rowStep = 245;
  const fontSize = 50;

  let tiles = '';
  let row = 0;
  for (let y = 90; y < height + rowStep; y += rowStep, row++) {
    for (let x = -120; x < width + colStep; x += colStep) {
      tiles += `<text x="${x}" y="${y}" transform="rotate(-35 ${x} ${y})" font-family="Arial" font-weight="bold" font-size="${fontSize}" fill="#FFFFFF" fill-opacity="0.6">${text}</text>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${tiles}</svg>`;
}

/**
 * Cloudinary transformation for a video: scale to the working width, then place the uploaded
 * watermark artwork over the whole frame. Two steps only, so it stays well under the URL limit.
 */
export function getCloudinaryVideoWatermarkTransformation(overlayId: string, width: number, height: number) {
  return [
    { width, crop: 'scale' },
    { overlay: overlayId, width, height, crop: 'scale', gravity: 'north_west', x: 0, y: 0 },
  ];
}

/**
 * Get Cloudinary transformation configuration for dense staggered tiled (repeated grid) image and video watermarking.
 */
export function getCloudinaryWatermarkTransformation(watermarkText: string = '©BIRDEARNER', isVideo: boolean = false) {
  const textToUse = watermarkText || '©BIRDEARNER';

  return [
    {
      overlay: {
        font_family: 'Arial',
        font_size: 50,
        font_weight: 'bold',
        text: `${textToUse}          `,
      },
      color: '#FFFFFF',
      opacity: 60,
      angle: -35,
      flags: 'tiled',
    },
  ];
}
