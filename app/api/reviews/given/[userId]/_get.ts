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
            .selectFrom('reviews as r')
            .where('r.reviewerId', '=', userId)

            // Join job for job details
            .leftJoin('jobs as j', 'r.jobId', 'j.id')

            // Join users to get reviewee details
            .leftJoin('users as reviewee', 'r.revieweeId', 'reviewee.id')

            // Join clients to get client specific info
            .leftJoin('clients as c', 'reviewee.id', 'c.userId')

            // Join freelancers to get freelancer specific info
            .leftJoin('freelancers as f', 'reviewee.id', 'f.userId')

            .select([
                'r.id',
                'r.reviewerId',
                'r.revieweeId',
                'r.jobId',
                'r.rating',
                'r.ratingDetails',
                'r.reviewText',
                'r.reviewType',
                'r.createdAt',
                'r.updatedAt',
                'j.jobTitle as job_jobTitle',
                'j.jobStatus as job_jobStatus',
                'reviewee.id as reviewee_id',
                'reviewee.fullName as reviewee_fullName',
                'reviewee.email as reviewee_email',
                'c.profilePhoto as client_profilePhoto',
                'c.city as client_city',
                'c.country as client_country',
                'f.profilePhoto as freelancer_profilePhoto',
                'f.city as freelancer_city',
                'f.country as freelancer_country'
            ])
            .orderBy('r.createdAt', 'desc');

        if (type) {
            query = query.where('r.reviewType', '=', type as any);
        }

        const rawReviews = await query.execute();

        const formattedReviews = rawReviews.map(review => {
            const isClientReviewee = review.client_profilePhoto !== null || review.client_city !== null || review.client_country !== null;
            const profilePhoto = isClientReviewee ? review.client_profilePhoto : review.freelancer_profilePhoto;

            let city = isClientReviewee ? review.client_city : review.freelancer_city;
            let country = isClientReviewee ? review.client_country : review.freelancer_country;

            return {
                id: review.id,
                reviewerId: review.reviewerId,
                revieweeId: review.revieweeId,
                jobId: review.jobId,
                rating: review.rating,
                ratingDetails: review.ratingDetails,
                reviewText: review.reviewText,
                reviewType: review.reviewType,
                createdAt: review.createdAt,
                updatedAt: review.updatedAt,
                job: {
                    jobTitle: review.job_jobTitle,
                    jobStatus: review.job_jobStatus
                },
                reviewee: {
                    id: review.reviewee_id,
                    fullName: review.reviewee_fullName,
                    email: review.reviewee_email,
                    profilePhoto: profilePhoto,
                    location: city ? `${city}, ${country}` : 'Unknown Location'
                }
            };
        });

        return NextResponse.json({
            success: true,
            data: formattedReviews
        });

    } catch (error) {
        console.error("Error fetching reviews given by user id:", error);
        return NextResponse.json(
            { success: false, error: "Failed to fetch reviews" },
            { status: 500 }
        );
    }
}
