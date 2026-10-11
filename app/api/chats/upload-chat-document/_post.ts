import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import {
  watermarkPdfBuffer,
  getCloudinaryWatermarkTransformation,
  getCloudinaryVideoWatermarkTransformation,
  buildVideoWatermarkSvg,
} from '@/lib/utils/watermark';

// Videos are delivered at this width; the watermark artwork is built for the same frame size
const VIDEO_WORKING_WIDTH = 960;

export const maxDuration = 300; // Allow up to 5min for large video buffering + watermark processing

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

function getResourceType(file: File): 'image' | 'video' | 'raw' | 'auto' {
  const mime = (file.type || '').toLowerCase();
  const name = (file.name || '').toLowerCase();

  if (
    mime.startsWith('video/') ||
    name.endsWith('.mp4') ||
    name.endsWith('.mov') ||
    name.endsWith('.avi') ||
    name.endsWith('.mkv') ||
    name.endsWith('.webm') ||
    name.endsWith('.3gp')
  ) {
    return 'video';
  }

  if (
    mime.startsWith('image/') ||
    mime.includes('image') ||
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.png') ||
    name.endsWith('.webp') ||
    name.endsWith('.gif') ||
    name.endsWith('.svg') ||
    name.endsWith('.heic') ||
    name.endsWith('.heif') ||
    name.endsWith('.bmp')
  ) {
    return 'image';
  }

  return 'auto';
}

/**
 * Uploads the video watermark artwork for a frame size (once per size; re-uploading the same
 * size simply overwrites it) and returns its Cloudinary overlay reference.
 */
async function uploadVideoWatermarkOverlay(width: number, height: number): Promise<string> {
  const publicId = `grid-${width}x${height}`;
  const svg = buildVideoWatermarkSvg(width, height, '©BIRDEARNER');
  const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  await cloudinary.uploader.upload(dataUri, {
    folder: 'bird_earner/watermarks',
    public_id: publicId,
    resource_type: 'image',
    overwrite: true,
  });
  return `bird_earner:watermarks:${publicId}`;
}

function uploadToCloudinary(buffer: Buffer, options: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      ...options,
      chunk_size: 6000000, // 6MB chunks for video/large files
      // SDK default idle timeout is 60s — Cloudinary video watermark processing
      // exceeded it and the SDK aborted with 499 TimeoutError after ~60s idle.
      timeout: 240000,
    };

    const stream = cloudinary.uploader.upload_stream(uploadOptions, (error: any, result: any) => {
      if (error) reject(error);
      else resolve(result);
    });

    stream.end(buffer);
  });
}

export async function POST(request: Request) {
  const tStart = Date.now();
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ success: false, message: 'No file uploaded' }, { status: 400 });
    }
    console.log(`[chat-upload] start name=${file.name} type=${file.type} size=${file.size} watermark=${formData.get('watermark') === 'true'}`);

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const originalBuffer = Buffer.from(bytes);
    let watermarkedBuffer = Buffer.from(bytes);

    const resourceType = getResourceType(file);
    const isPdf = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf');
    const isImageOrVideo = resourceType === 'image' || resourceType === 'video';
    console.log(`[chat-upload] buffered in ${Date.now() - tStart}ms resource=${resourceType}`);

    let originalResult: any;
    let watermarkedResult: any;
    let originalUrl = '';
    let watermarkedUrl = '';
    // Raw assets are delivered exactly as named (no format appended), so keep the
    // original file extension in the public_id — browsers and online viewers rely
    // on it to pick a renderer (.docx, .xlsx, ...).
    const extMatch = (file.name || '').match(/\.([a-z0-9]{1,10})$/i);
    const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : '';

    // Normal attachment (existing attach button): upload the original file only, no watermark.
    // Watermarked upload (existing logic below) runs only when the client explicitly asks for it.
    const withWatermark = formData.get('watermark') === 'true';

    if (!withWatermark) {
      originalResult = await uploadToCloudinary(originalBuffer, {
        folder: 'bird_earner/chat_media/originals',
        resource_type: resourceType,
        // Only raw-ish (auto) assets need the extension kept: image/video types
        // (and PDFs, which auto-detect to image) get the format appended by
        // Cloudinary on delivery already — appending would double it (.pdf.pdf).
        public_id: `original-${Date.now()}-${Math.round(Math.random() * 1e9)}${resourceType === 'auto' && !isPdf ? ext : ''}`,
      });
      watermarkedResult = originalResult;
      originalUrl = originalResult.secure_url;
      watermarkedUrl = originalResult.secure_url;
    } else if (isImageOrVideo) {
      // Store both copies: the original (for the sender/admin records) and the watermarked
      // version that the chat delivers. Uploaded in parallel to keep the total time down.
      const isVideo = resourceType === 'video';
      const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

      if (isVideo) {
        // Videos: upload the original once and derive the watermarked copy from it.
        // A second full video upload doubled the time and tripped the tunnel timeout.
        originalResult = await uploadToCloudinary(originalBuffer, {
          folder: 'bird_earner/chat_media/originals',
          resource_type: 'video',
          public_id: `original-${stamp}`,
        });
        // The watermark artwork matches this video's frame size (portrait or landscape)
        const videoWidth = VIDEO_WORKING_WIDTH;
        const aspect = originalResult.width && originalResult.height
          ? originalResult.width / originalResult.height
          : 16 / 9;
        const videoHeight = Math.round(videoWidth / aspect);
        const overlayId = await uploadVideoWatermarkOverlay(videoWidth, videoHeight);
        const videoWatermark = getCloudinaryVideoWatermarkTransformation(overlayId, videoWidth, videoHeight);
        // Pre-generate the watermarked copy in the background; the URL below works either way
        cloudinary.uploader
          .explicit(originalResult.public_id, {
            type: 'upload',
            resource_type: 'video',
            eager: videoWatermark,
            eager_async: true,
          })
          .catch((err: any) => console.warn('[chat-upload] video watermark pre-generation failed:', err?.message || err));
        watermarkedUrl = cloudinary.url(originalResult.public_id, {
          resource_type: 'video',
          type: 'upload',
          secure: true,
          transformation: videoWatermark,
        });
        watermarkedResult = { ...originalResult, secure_url: watermarkedUrl };
        originalUrl = originalResult.secure_url;
      } else {
        // Images: store both copies (original + watermarked) in parallel
        const watermarkTrans = getCloudinaryWatermarkTransformation('©BIRDEARNER', false);
        [originalResult, watermarkedResult] = await Promise.all([
          uploadToCloudinary(originalBuffer, {
            folder: 'bird_earner/chat_media/originals',
            resource_type: resourceType,
            public_id: `original-${stamp}`,
          }),
          uploadToCloudinary(originalBuffer, {
            folder: 'bird_earner/chat_media',
            resource_type: resourceType,
            public_id: `wm-${stamp}`,
            transformation: watermarkTrans,
          }),
        ]);
        originalUrl = originalResult.secure_url;
        watermarkedUrl = watermarkedResult.secure_url;
      }
    } else if (isPdf) {
      // PDF watermarked locally via pdf-lib; original and watermarked copies stored
      watermarkedBuffer = await watermarkPdfBuffer(originalBuffer, '©BIRDEARNER');
      const stamp = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;

      [originalResult, watermarkedResult] = await Promise.all([
        uploadToCloudinary(originalBuffer, {
          folder: 'bird_earner/chat_media/originals',
          resource_type: resourceType,
          public_id: `original-${stamp}`,
        }),
        uploadToCloudinary(watermarkedBuffer, {
          folder: 'bird_earner/chat_media',
          resource_type: resourceType,
          public_id: `wm-${stamp}`,
        }),
      ]);
      originalUrl = originalResult.secure_url;
      watermarkedUrl = watermarkedResult.secure_url;
    } else {
      // Generic Raw File (extension kept via shared `ext` above)
      const singleOptions: any = {
        folder: 'bird_earner/chat_media/originals',
        resource_type: resourceType,
        public_id: `original-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`,
      };
      originalResult = await uploadToCloudinary(originalBuffer, singleOptions);
      watermarkedResult = originalResult;
      originalUrl = originalResult.secure_url;
      watermarkedUrl = originalResult.secure_url;
    }

    console.log(`[chat-upload] done in ${Date.now() - tStart}ms`);

    return NextResponse.json({
      success: true,
      message: 'File uploaded successfully',
      secure_url: watermarkedUrl,
      url: watermarkedUrl,
      original_secure_url: originalUrl,
      originalUrl: originalUrl,
      cloudinaryPublicId: watermarkedResult.public_id,
      originalCloudinaryPublicId: originalResult.public_id,
      public_id: watermarkedResult.public_id,
      filename: watermarkedResult.public_id,
      originalName: file.name,
      size: file.size,
      mimeType: file.type,
      mimetype: file.type,
      data: {
        url: watermarkedUrl,
        originalUrl: originalUrl,
        filename: watermarkedResult.public_id,
        originalFilename: originalResult.public_id,
        originalName: file.name,
        size: file.size,
        mimetype: file.type,
        cloudinaryPublicId: watermarkedResult.public_id,
        originalCloudinaryPublicId: originalResult.public_id,
      },
    });
  } catch (error: any) {
    console.error(`Chat document upload error after ${Date.now() - tStart}ms:`, error);
    return NextResponse.json({
      success: false,
      message: error.message || 'File upload failed',
    }, { status: 500 });
  }
}
