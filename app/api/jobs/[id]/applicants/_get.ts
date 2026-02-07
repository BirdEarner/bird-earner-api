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
                'freelancers.profilePhoto',
                'freelancers.profileHeading',
                'freelancers.experience',
                'freelancers.rating',
                'freelancers.level',
                'chatThreads.isAccepted',
                'users.email'
            ])
            .where('chatThreads.jobId', '=', id)
            .execute();

        return NextResponse.json({
            success: true,
            data: applicants
        });
    } catch (error: any) {
        console.error('Get applicants error:', error);
        return NextResponse.json({
            success: false,
            message: error.message || 'Server error'
        }, { status: 500 });
    }
}
