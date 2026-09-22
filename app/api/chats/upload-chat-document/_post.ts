import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { watermarkPdfBuffer, getCloudinaryWatermarkTransformation } from '@/lib/utils/watermark';

export const maxDuration = 60; // Allow 60s for video/large file uploads

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
    name.endsWith('.jpg') ||
    name.endsWith('.jpeg') ||
    name.endsWith('.png') ||
    name.endsWith('.webp') ||
    name.endsWith('.gif') ||
    name.endsWith('.svg')
  ) {
    return 'image';
  }

  return 'auto';
}

function uploadToCloudinary(buffer: Buffer, options: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const isLargeOrVideo = options.resource_type === 'video' || buffer.length > 10 * 1024 * 1024;
    const uploadOptions = {
      ...options,
      chunk_size: 6000000, // 6MB chunks for large files/videos to prevent HTTP 413 Payload Too Large
    };

    if (isLargeOrVideo) {
      const stream = cloudinary.uploader.upload_large_stream(uploadOptions, (error: any, result: any) => {
        if (error) reject(error);
        else resolve(result);
      });
      stream.end(buffer);
    } else {
      const stream = cloudinary.uploader.upload_stream(uploadOptions, (error: any, result: any) => {
        if (error) reject(error);
        else resolve(result);
      });
      stream.end(buffer);
    }
  });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ success: false, message: 'No file uploaded' }, { status: 400 });
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const originalBuffer = Buffer.from(bytes);
    let watermarkedBuffer = Buffer.from(bytes);

    const resourceType = getResourceType(file);
    const isPdf = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf');
    const isImageOrVideo = resourceType === 'image' || resourceType === 'video';

    // 1. Upload original unwatermarked file
    const originalOptions: any = {
      folder: 'bird_earner/chat_media/originals',
      resource_type: resourceType,
      public_id: `original-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
    };

    // 2. Prepare watermarked version
    if (isPdf) {
      watermarkedBuffer = await watermarkPdfBuffer(originalBuffer, '©BIRDEARNER');
    }

    const watermarkedUploadOptions: any = {
      folder: 'bird_earner/chat_media',
      resource_type: resourceType,
      public_id: `wm-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
    };

    if (isImageOrVideo) {
      watermarkedUploadOptions.transformation = getCloudinaryWatermarkTransformation('©BIRDEARNER');
    }

    // Execute both uploads in parallel using uploadToCloudinary (handles large files/videos without HTTP 413)
    const [originalResult, watermarkedResult] = await Promise.all([
      uploadToCloudinary(originalBuffer, originalOptions),
      uploadToCloudinary(watermarkedBuffer, watermarkedUploadOptions),
    ]);

    return NextResponse.json({
      success: true,
      message: 'File uploaded successfully',
      secure_url: watermarkedResult.secure_url,
      url: watermarkedResult.secure_url,
      original_secure_url: originalResult.secure_url,
      originalUrl: originalResult.secure_url,
      cloudinaryPublicId: watermarkedResult.public_id,
      originalCloudinaryPublicId: originalResult.public_id,
      public_id: watermarkedResult.public_id,
      filename: watermarkedResult.public_id,
      originalName: file.name,
      size: file.size,
      mimeType: file.type,
      mimetype: file.type,
      data: {
        url: watermarkedResult.secure_url,
        originalUrl: originalResult.secure_url,
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
    console.error('Chat document upload error:', error);
    return NextResponse.json({
      success: false,
      message: error.message || 'File upload failed',
    }, { status: 500 });
  }
}
