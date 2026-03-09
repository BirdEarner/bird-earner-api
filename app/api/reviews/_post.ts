import { NextResponse } from "next/server";
import { getAuthUser } from "@/lib/auth";
import { createReview } from "@/lib/services/reviews";

export async function POST(request: Request) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
        }

        const body = await request.json();
        const {
            reviewerId,
            revieweeId,
            jobId,
            rating,
            ratingDetails,
            reviewText,
            reviewType,
            messageId
        } = body;

        // Basic validation
        if (!reviewerId || !revieweeId || !rating || !reviewType) {
            return NextResponse.json({
                success: false,
                error: "Missing required fields"
            }, { status: 400 });
        }

        const review = await createReview({
            reviewerId,
            revieweeId,
            jobId,
            rating,
            ratingDetails,
            reviewText,
            reviewType,
            messageId
        });

        return NextResponse.json({
            success: true,
            data: review
        });
    } catch (error: any) {
        console.error("Create review API error:", error);
        return NextResponse.json({
            success: false,
            error: error.message || "Failed to create review"
        }, { status: 500 });
    }
}
