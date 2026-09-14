import { db } from '@/lib/db';
import { getAuthUser } from '@/lib/auth';
import { NextResponse } from 'next/server';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const user = await getAuthUser();
        if (!user) {
            return NextResponse.json({ message: 'Unauthorized' }, { status: 401 });
        }

        const { id } = await params;

        const applicants = await db
            .selectFrom('chatThreads')
            .innerJoin('freelancers', 'freelancers.id', 'chatThreads.freelancerId')
            .innerJoin('users', 'users.id', 'freelancers.userId')
            .select([
                'freelancers.id',
                'freelancers.userId',
                'users.fullName',
                'users.profilePhoto',
                'freelancers.profileHeading',
                'freelancers.freelancerCategory',
                'freelancers.experience',
                'freelancers.rating',
                'freelancers.level',
                'chatThreads.isAccepted',
                'chatThreads.freelancerOffer',
                'chatThreads.freelancerDays',
                'chatThreads.agreedAmount',
                'chatThreads.agreedDays',
                'users.email'
            ])
            .where('chatThreads.jobId', '=', id)
            .where('chatThreads.status', '!=', 'BLOCKED')
            .execute();

        const data = applicants.map(app => ({
            id: app.id,
            userId: app.userId,
            profilePhoto: app.profilePhoto,
            profileHeading: app.profileHeading,
            freelancerCategory: app.freelancerCategory,
            experience: app.experience,
            rating: app.rating,
            level: app.level,
            isAccepted: app.isAccepted,
            freelancerOffer: app.freelancerOffer,
            freelancerDays: app.freelancerDays,
            agreedAmount: app.agreedAmount,
            agreedDays: app.agreedDays,
            user: {
                id: app.userId,
                fullName: app.fullName,
                email: app.email
            }
        }));

        return NextResponse.json({
            success: true,
            data
        });
    } catch (error: any) {
        console.error('Get applicants error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
