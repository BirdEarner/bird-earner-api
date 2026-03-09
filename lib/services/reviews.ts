import { db } from "../db";

/**
 * Calculates current level based on total XP
 * Matching the logic in the original Express backend
 */
export const calculateLevel = (totalXP: number) => {
    const baseXP = 100;
    const incrementXP = 100;
    let level = 1;
    let xpForNextLevel = baseXP;
    let tempXP = totalXP;

    while (tempXP >= xpForNextLevel) {
        level += 1;
        tempXP -= xpForNextLevel;
        xpForNextLevel += incrementXP;
    }
    return level;
};

interface CreateReviewData {
    reviewerId: string;
    revieweeId: string;
    jobId: string | null;
    rating: number;
    ratingDetails: any;
    reviewText: string | null;
    reviewType: string;
    messageId?: string | null;
}

export const createReview = async (data: CreateReviewData) => {
    const {
        reviewerId,
        revieweeId,
        jobId,
        rating,
        ratingDetails,
        reviewText,
        reviewType,
        messageId
    } = data;

    return await db.transaction().execute(async (trx) => {
        // 1. Create the review
        // Note: reviewType from frontend is 'FREELANCER' or 'CLIENT'
        // We might want to set freelancerId or clientId if we can find them
        let freelancerId = null;
        let clientId = null;

        if (reviewType === 'FREELANCER') {
            const freelancer = await trx
                .selectFrom('freelancers')
                .select('id')
                .where('userId', '=', revieweeId)
                .executeTakeFirst();
            freelancerId = freelancer?.id || null;
        } else if (reviewType === 'CLIENT') {
            const client = await trx
                .selectFrom('clients')
                .select('id')
                .where('userId', '=', revieweeId)
                .executeTakeFirst();
            clientId = client?.id || null;
        }

        const review = await trx
            .insertInto('reviews')
            .values({
                id: crypto.randomUUID(),
                reviewerId,
                revieweeId,
                jobId: jobId || null,
                rating,
                ratingDetails: ratingDetails ? JSON.stringify(ratingDetails) : null,
                reviewText,
                reviewType,
                freelancerId,
                clientId,
                updatedAt: new Date(),
            })
            .returningAll()
            .executeTakeFirstOrThrow();

        // 2. Update freelancer stats if applicable
        if (reviewType === 'FREELANCER' && freelancerId) {
            const freelancer = await trx
                .selectFrom('freelancers')
                .selectAll()
                .where('id', '=', freelancerId)
                .executeTakeFirst();

            if (freelancer) {
                const currentXP = freelancer.xp || 0;
                const baseXP = 40;
                const bonusXP = Math.round(rating * 9);
                const newTotalXP = currentXP + baseXP + bonusXP;
                const newLevel = calculateLevel(newTotalXP);

                // Recalculate average rating
                const allRatings = await trx
                    .selectFrom('reviews')
                    .select('rating')
                    .where('revieweeId', '=', revieweeId)
                    .where('reviewType', '=', 'FREELANCER')
                    .execute();

                const totalRatingsSum = allRatings.reduce((acc, curr) => acc + curr.rating, 0);
                const count = allRatings.length;
                const averageRating = count > 0 ? Math.round(totalRatingsSum / count) : rating;

                await trx
                    .updateTable('freelancers')
                    .set({
                        xp: newTotalXP,
                        level: newLevel,
                        rating: averageRating,
                        updatedAt: new Date(),
                    })
                    .where('id', '=', freelancerId)
                    .execute();
            }
        }

        // 3. Update the chat message status if messageId is provided
        if (messageId) {
            const message = await trx
                .selectFrom('messages')
                .select(['messageContent'])
                .where('id', '=', messageId)
                .executeTakeFirst();

            if (message) {
                try {
                    const content = JSON.parse(message.messageContent);
                    content.status = 'completed';
                    await trx
                        .updateTable('messages')
                        .set({
                            messageContent: JSON.stringify(content),
                            updatedAt: new Date(),
                        })
                        .where('id', '=', messageId)
                        .execute();
                } catch (e) {
                    console.error("Failed to parse/update message content for review", e);
                    // Fallback to simple completed status if not JSON
                    await trx
                        .updateTable('messages')
                        .set({
                            messageContent: JSON.stringify({ status: 'completed' }),
                            updatedAt: new Date(),
                        })
                        .where('id', '=', messageId)
                        .execute();
                }
            }
        }

        return review;
    });
};
