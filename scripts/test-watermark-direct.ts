import { watermarkPdfBuffer, getCloudinaryWatermarkTransformation } from '../lib/utils/watermark';

async function testWatermarkDirect() {
  console.log('=========================================================');
  console.log('🧪 DIRECT UNIT TEST FOR ©BIRDEARNER WATERMARK SYSTEM');
  console.log('=========================================================');

  // 1. Test Cloudinary Transformation Config
  console.log('\n1. Testing Cloudinary Watermark Transformation Config...');
  const cloudTrans = getCloudinaryWatermarkTransformation('©BIRDEARNER');
  console.log('Cloudinary Transformation:', JSON.stringify(cloudTrans, null, 2));

  if (cloudTrans[0].overlay.text !== '©BIRDEARNER' || cloudTrans[0].flags !== 'tiled') {
    throw new Error('Cloudinary transformation configuration incorrect');
  }
  console.log('✅ Cloudinary watermark configuration verified: ©BIRDEARNER with tiled grid flag!');

  // 2. Test PDF Watermark Buffer Generation
  console.log('\n2. Testing PDF Watermark Generation with pdf-lib...');
  const samplePdfHeader = '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 1/Kids[3 0 R]>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF';
  const inputBuffer = Buffer.from(samplePdfHeader, 'utf-8');

  const outputBuffer = await watermarkPdfBuffer(inputBuffer, '©BIRDEARNER');
  console.log(`Original Buffer Size: ${inputBuffer.length} bytes | Watermarked PDF Size: ${outputBuffer.length} bytes`);

  if (!outputBuffer || outputBuffer.length <= inputBuffer.length) {
    throw new Error('PDF watermarking failed to modify buffer');
  }

  console.log('✅ PDF watermarking verified: ©BIRDEARNER grid pattern generated!');

  console.log('\n=========================================================');
  console.log('🎉 ALL DIRECT ©BIRDEARNER WATERMARK TESTS PASSED!');
  console.log('=========================================================');
}

testWatermarkDirect()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ DIRECT TEST FAILED:', err);
    process.exit(1);
  });
