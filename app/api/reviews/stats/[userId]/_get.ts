import { db } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ userId: string }> }
) {
    try {
        const { userId } = await params;
        const searchParams = request.nextUrl.searchParams;
        const type = searchParams.get('type');

        let query = db
            .selectFrom('reviews')
            .where('revieweeId', '=', userId)
            .select(['rating']);

        if (type) {
            query = query.where('reviewType', '=', type as any);
        }

        const reviews = await query.execute();

        const totalReviews = reviews.length;
        const averageRating = totalReviews > 0
            ? Math.round(reviews.reduce((acc, curr) => acc + curr.rating, 0) / totalReviews)
            : 0;

        const ratingDistribution = {
            5: reviews.filter(r => r.rating === 5).length,
            4: reviews.filter(r => r.rating === 4).length,
            3: reviews.filter(r => r.rating === 3).length,
            2: reviews.filter(r => r.rating === 2).length,
            1: reviews.filter(r => r.rating === 1).length,
        };

        return NextResponse.json({
            success: true,
            data: {
                totalReviews,
                averageRating,
                ratingDistribution
            }
        });

    } catch (error) {
        console.error("Error fetching review stats:", error);
        return NextResponse.json(
            { success: false, error: "Failed to fetch review statistics" },
            { status: 500 }
        );
    }
}
