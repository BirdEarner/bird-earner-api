import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';

/**
 * Apply a dense staggered grid semi-transparent "©BIRDEARNER" text watermark diagonally across every page of a PDF document.
 */
export async function watermarkPdfBuffer(inputBuffer: Buffer, watermarkText: string = '©BIRDEARNER'): Promise<Buffer> {
  try {
    const pdfDoc = await PDFDocument.load(inputBuffer, { ignoreEncryption: true });
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const pages = pdfDoc.getPages();

    for (const page of pages) {
      const { width, height } = page.getSize();
      const fontSize = Math.max(16, Math.min(width, height) / 22);

      const stepX = 140;
      const stepY = 90;

      let rowIndex = 0;
      for (let y = -60; y < height + 120; y += stepY) {
        const rowOffsetX = (rowIndex % 2 === 0) ? 0 : stepX / 2;
        for (let x = -80 + rowOffsetX; x < width + 120; x += stepX) {
          page.drawText(watermarkText, {
            x: x,
            y: y,
            size: fontSize,
            font: font,
            color: rgb(0.7, 0.7, 0.7),
            opacity: 0.42,
            rotate: degrees(32),
          });
        }
        rowIndex++;
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
 * Get Cloudinary transformation configuration for dense staggered tiled (repeated grid) image and video watermarking.
 */
export function getCloudinaryWatermarkTransformation(watermarkText: string = '©BIRDEARNER', isVideo: boolean = false) {
  if (isVideo) {
    const spaces = '               '; // 15 spaces for wide spaced watermark pattern
    const rowA = `${watermarkText}${spaces}${watermarkText}${spaces}${watermarkText}${spaces}${watermarkText}${spaces}${watermarkText}`;
    const rowB = `        ${watermarkText}${spaces}${watermarkText}${spaces}${watermarkText}${spaces}${watermarkText}${spaces}${watermarkText}`;

    // 24 staggered rows to ensure complete edge-to-edge coverage even on vertical HD videos
    const multilineMatrix = Array(12).fill(null).map(() => `${rowA}\n${rowB}`).join('\n');

    return [
      {
        overlay: {
          font_family: 'Arial',
          font_size: 40,
          font_weight: 'bold',
          text: multilineMatrix,
        },
        color: '#FFFFFF',
        opacity: 45,
        angle: -32,
        gravity: 'center',
      },
    ];
  }

  return [
    {
      overlay: {
        font_family: 'Arial',
        font_size: 30,
        font_weight: 'bold',
        text: watermarkText,
      },
      color: '#FFFFFF',
      opacity: 45,
      angle: -32,
      flags: 'tiled',
    },
  ];
}
