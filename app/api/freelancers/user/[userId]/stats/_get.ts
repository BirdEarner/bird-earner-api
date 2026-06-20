import { db } from '@/lib/db';
import { NextResponse } from 'next/server';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { userId } = await params;
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'All Time';

    // 1. Get the freelancer profile and related user
    const freelancer = await db
      .selectFrom('freelancers')
      .selectAll()
      .where('userId', '=', userId)
      .executeTakeFirst();

    if (!freelancer) {
      return NextResponse.json({
        success: false,
        message: 'Freelancer profile not found'
      }, { status: 404 });
    }

    // Determine the date filter based on the period
    let dateFilter = new Date(0); // Default to beginning of time
    const now = new Date();

    if (period === 'Last 7 Days') {
      dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else if (period === 'Last 30 Days') {
      dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else if (period === 'This Month') {
      dateFilter = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'This Year') {
      dateFilter = new Date(now.getFullYear(), 0, 1);
    }

    // 2. Query Jobs to calculate success score and orders completed
    let jobsQuery = db
      .selectFrom('jobs')
      .where('assignedFreelancerId', '=', freelancer.id);

    if (period !== 'All Time') {
       jobsQuery = jobsQuery.where('createdAt', '>=', dateFilter);
    }

    const jobs = await jobsQuery
      .select(['jobStatus'])
      .execute();

    let totalOrders = jobs.length;
    let completedOrders = 0;

    for (const job of jobs) {
      if (job.jobStatus === 'COMPLETED') {
        completedOrders++;
      }
    }

    const successScore = totalOrders > 0 
      ? Math.round((completedOrders / totalOrders) * 100) 
      : 0;

    // 3. Response Rate (Placeholder logic: 95% if they have jobs, 0 if not)
    // In a real app, this would be computed from message response times
    const responseRate = totalOrders > 0 ? 95 : 0;

    // 4. Flags Count (Parse from JSON if exists, else 0)
    let flagsCount = 0;
    try {
        if (freelancer.flags) {
            const flags = typeof freelancer.flags === 'string' ? JSON.parse(freelancer.flags) : freelancer.flags;
            flagsCount = Array.isArray(flags) ? flags.length : 0;
        }
    } catch (e) {
        flagsCount = 0;
    }

    // Determine Rank based on level
    let rank = 'Newbie';
    if (freelancer.level >= 10) rank = 'Top Rated';
    else if (freelancer.level >= 5) rank = 'Level 2';
    else if (freelancer.level >= 2) rank = 'Level 1';

    const data = {
      period,
      stats: {
        successScore,
        averageRating: Number(freelancer.rating) || 0,
        responseRate,
        ordersCompleted: completedOrders,
        totalOrders
      },
      profile: {
        level: freelancer.level || 1,
        xp: freelancer.xp || 0,
        rank,
        flagsCount
      }
    };

    return NextResponse.json({
      success: true,
      message: 'Profile statistics retrieved successfully',
      data
    });

  } catch (error: any) {
    console.error('Get freelancer profile stats error:', error);
    return NextResponse.json({
      success: false,
      message: error.message || 'Server error'
    }, { status: 500 });
  }
}
