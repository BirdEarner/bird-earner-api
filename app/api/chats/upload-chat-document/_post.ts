import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { watermarkPdfBuffer, getCloudinaryWatermarkTransformation } from '@/lib/utils/watermark';

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

    // Normal attachment (existing attach button): upload the original file only, no watermark.
    // Watermarked upload (existing logic below) runs only when the client explicitly asks for it.
    const withWatermark = formData.get('watermark') === 'true';

    if (!withWatermark) {
      originalResult = await uploadToCloudinary(originalBuffer, {
        folder: 'bird_earner/chat_media/originals',
        resource_type: resourceType,
        public_id: `original-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
      });
      watermarkedResult = originalResult;
      originalUrl = originalResult.secure_url;
      watermarkedUrl = originalResult.secure_url;
    } else if (isImageOrVideo) {
      // Single upload only: the response's original* fields are never read by any
      // client, and a second Cloudinary copy doubled the server's uplink time —
      // big videos then exceeded the tunnel's ~100s response window and the
      // client connection was dropped.
      const isVideo = resourceType === 'video';
      const watermarkTrans = getCloudinaryWatermarkTransformation('©BIRDEARNER', isVideo);

      const watermarkedUploadOptions: any = {
        folder: 'bird_earner/chat_media',
        resource_type: resourceType,
        public_id: `wm-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
        transformation: watermarkTrans,
      };

      watermarkedResult = await uploadToCloudinary(originalBuffer, watermarkedUploadOptions);
      originalResult = watermarkedResult;
      originalUrl = watermarkedResult.secure_url;
      watermarkedUrl = watermarkedResult.secure_url;
    } else if (isPdf) {
      // PDF watermarked locally via pdf-lib — single upload (see note above)
      watermarkedBuffer = await watermarkPdfBuffer(originalBuffer, '©BIRDEARNER');

      const watermarkedUploadOptions: any = {
        folder: 'bird_earner/chat_media',
        resource_type: resourceType,
        public_id: `wm-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
      };

      watermarkedResult = await uploadToCloudinary(watermarkedBuffer, watermarkedUploadOptions);
      originalResult = watermarkedResult;
      originalUrl = watermarkedResult.secure_url;
      watermarkedUrl = watermarkedResult.secure_url;
    } else {
      // Generic Raw File
      const singleOptions: any = {
        folder: 'bird_earner/chat_media/originals',
        resource_type: resourceType,
        public_id: `original-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
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
