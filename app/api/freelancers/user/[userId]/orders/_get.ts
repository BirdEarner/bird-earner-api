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

    // 1. Get the freelancer ID for this user
    const freelancer = await db
      .selectFrom('freelancers')
      .select(['id'])
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

    // 2. Query Jobs assigned to this freelancer
    let jobsQuery = db
      .selectFrom('jobs')
      .where('assignedFreelancerId', '=', freelancer.id);

    if (period !== 'All Time') {
       jobsQuery = jobsQuery.where('createdAt', '>=', dateFilter);
    }

    const jobs = await jobsQuery
      .select(['id', 'jobTitle', 'jobStatus', 'budgetAmount', 'createdAt'])
      .orderBy('createdAt', 'desc')
      .execute();

    let totalOrders = jobs.length;
    let activeOrders = 0;
    let completedOrders = 0;
    let cancelledOrders = 0;
    let activeValue = 0;
    let completedValue = 0;

    for (const job of jobs) {
      const amount = Number(job.budgetAmount) || 0;
      if (job.jobStatus === 'IN_PROGRESS' || job.jobStatus === 'OPEN') {
        activeOrders++;
        activeValue += amount;
      } else if (job.jobStatus === 'COMPLETED') {
        completedOrders++;
        completedValue += amount;
      } else if (job.jobStatus === 'CANCELLED') {
        cancelledOrders++;
      }
    }

    // Get 10 most recent jobs for the UI list
    const recentOrders = jobs.slice(0, 10);

    const data = {
      period,
      summary: {
        totalOrders,
        activeOrders: { count: activeOrders, value: activeValue },
        completedOrders: { count: completedOrders, value: completedValue },
        cancelledOrders
      },
      recentOrders
    };

    return NextResponse.json({
      success: true,
      message: 'Orders statistics retrieved successfully',
      data
    });

  } catch (error: any) {
    console.error('Get freelancer orders stats error:', error);
    return NextResponse.json({
      success: false,
      message: error.message || 'Server error'
    }, { status: 500 });
  }
}
