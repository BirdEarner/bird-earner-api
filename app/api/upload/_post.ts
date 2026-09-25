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

const uploadCategories: Record<string, string> = {
    client_profile_photos: "bird_earner/client_profile_photos",
    freelancer_profile_photos: "bird_earner/freelancer_profile_photos",
    client_cover_photos: "bird_earner/client_cover_photos",
    freelancer_cover_photos: "bird_earner/freelancer_cover_photos",
    freelancer_portfolios: "bird_earner/freelancer_portfolios",
    job_portfolios: "bird_earner/job_portfolios",
    service_images: "bird_earner/service_images",
    chat_media: "bird_earner/chat_media",
    file_manager: "bird_earner/file_manager",
    notification_images: "bird_earner/notification_images",
    home_promo_images: "bird_earner/home_promo_images",
};

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
        };

        const stream = cloudinary.uploader.upload_stream(uploadOptions, (error: any, result: any) => {
            if (error) reject(error);
            else resolve(result);
        });

        stream.end(buffer);
    });
}

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const category = (formData.get('uploadCategory') || formData.get('category')) as string || "chat_media";

        if (!file) {
            return NextResponse.json({ success: false, message: 'No file uploaded' }, { status: 400 });
        }

        if (!uploadCategories[category]) {
            return NextResponse.json({
                success: false,
                message: `Invalid upload category. Valid options: ${Object.keys(uploadCategories).join(', ')}`
            }, { status: 400 });
        }

        // Convert file to buffer
        const bytes = await file.arrayBuffer();
        const originalBuffer = Buffer.from(bytes);
        let watermarkedBuffer = Buffer.from(bytes);

        const resourceType = getResourceType(file);
        const isPdf = file.type === 'application/pdf' || file.name?.toLowerCase().endsWith('.pdf');
        const isImageOrVideo = resourceType === 'image' || resourceType === 'video';
        const requiresWatermark = ['chat_media', 'file_manager', 'job_portfolios', 'freelancer_portfolios'].includes(category);

        let originalResult: any = null;
        let watermarkedResult: any = null;

        let originalUrl = '';
        let watermarkedUrl = '';

        if (requiresWatermark && isImageOrVideo) {
            const isVideo = resourceType === 'video';
            const watermarkTrans = getCloudinaryWatermarkTransformation('©BIRDEARNER', isVideo);

            const originalOptions: any = {
                folder: `${uploadCategories[category]}/originals`,
                resource_type: resourceType,
                public_id: `original-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
            };

            const watermarkedUploadOptions: any = {
                folder: uploadCategories[category],
                resource_type: resourceType,
                public_id: `wm-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
                transformation: watermarkTrans,
            };

            [originalResult, watermarkedResult] = await Promise.all([
                uploadToCloudinary(originalBuffer, originalOptions),
                uploadToCloudinary(originalBuffer, watermarkedUploadOptions),
            ]);

            originalUrl = originalResult.secure_url;
            watermarkedUrl = watermarkedResult.secure_url;
        } else if (requiresWatermark && isPdf) {
            // PDF watermarked locally via pdf-lib
            watermarkedBuffer = await watermarkPdfBuffer(originalBuffer, '©BIRDEARNER');

            const originalOptions: any = {
                folder: `${uploadCategories[category]}/originals`,
                resource_type: resourceType,
                public_id: `original-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
            };

            const uploadOptions: any = {
                folder: uploadCategories[category],
                resource_type: resourceType,
                public_id: `wm-${Date.now()}-${Math.round(Math.random() * 1e9)}`,
            };

            [originalResult, watermarkedResult] = await Promise.all([
                uploadToCloudinary(originalBuffer, originalOptions),
                uploadToCloudinary(watermarkedBuffer, uploadOptions),
            ]);

            originalUrl = originalResult.secure_url;
            watermarkedUrl = watermarkedResult.secure_url;
        } else {
            // Standard single file upload without watermarking
            const singleOptions: any = {
                folder: uploadCategories[category],
                resource_type: resourceType,
                public_id: `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
            };

            watermarkedResult = await uploadToCloudinary(originalBuffer, singleOptions);
            originalResult = watermarkedResult;
            originalUrl = originalResult.secure_url;
            watermarkedUrl = originalResult.secure_url;
        }

        return NextResponse.json({
            success: true,
            message: "File uploaded successfully",
            secure_url: watermarkedUrl,
            url: watermarkedUrl,
            original_secure_url: originalUrl,
            originalUrl: originalUrl,
            public_id: watermarkedResult.public_id,
            filename: watermarkedResult.public_id,
            originalName: file.name,
            size: file.size,
            mimetype: file.type,
            category,
            data: {
                url: watermarkedUrl,
                originalUrl: originalUrl,
                filename: watermarkedResult.public_id,
                originalFilename: originalResult.public_id,
                originalName: file.name,
                size: file.size,
                mimetype: file.type,
                category,
                cloudinaryPublicId: watermarkedResult.public_id,
                originalCloudinaryPublicId: originalResult.public_id,
            },
        });

    } catch (error: any) {
        console.error('Upload error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'File upload failed'
        }, { status: 500 });
    }
}
