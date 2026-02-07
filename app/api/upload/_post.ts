import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';

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
};

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File;
        const category = (formData.get('uploadCategory') || formData.get('category')) as string;

        if (!file) {
            return NextResponse.json({ success: false, message: 'No file uploaded' }, { status: 400 });
        }

        if (!category || !uploadCategories[category]) {
            return NextResponse.json({
                success: false,
                message: `Invalid or missing upload category. Valid options: ${Object.keys(uploadCategories).join(', ')}`
            }, { status: 400 });
        }

        // Convert file to buffer
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);

        // Upload to Cloudinary
        const result = await new Promise<any>((resolve, reject) => {
            cloudinary.uploader.upload_stream(
                {
                    folder: uploadCategories[category],
                    resource_type: 'auto',
                    public_id: `${Date.now()}-${Math.round(Math.random() * 1e9)}`,
                },
                (error, result) => {
                    if (error) reject(error);
                    else resolve(result);
                }
            ).end(buffer);
        });

        return NextResponse.json({
            success: true,
            message: "File uploaded successfully",
            secure_url: result.secure_url,
            public_id: result.public_id,
            filename: result.public_id,
            originalName: file.name,
            size: file.size,
            mimetype: file.type,
            category,
            // For backward compatibility
            data: {
                url: result.secure_url,
                filename: result.public_id,
                originalName: file.name,
                size: file.size,
                mimetype: file.type,
                category,
                cloudinaryPublicId: result.public_id,
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
