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
      .select(['id', 'totalEarnings', 'withdrawableAmount', 'outstandingAmount'])
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
    // For specific months (April, May, June) from the original UI
    else if (period === 'April') {
      dateFilter = new Date(now.getFullYear(), 3, 1);
      const endFilter = new Date(now.getFullYear(), 4, 1);
    }

    // Since Kysely needs a specific format for dates or we can just pass Date objects,
    // let's use the dateFilter in our queries.
    
    // 2. Aggregate Job Data for the period
    let jobsQuery = db
      .selectFrom('jobs')
      .where('assignedFreelancerId', '=', freelancer.id)
      .where('deleted', '=', false);

    if (period !== 'All Time') {
      if (period === 'April') {
         jobsQuery = jobsQuery.where('createdAt', '>=', new Date(now.getFullYear(), 3, 1)).where('createdAt', '<', new Date(now.getFullYear(), 4, 1));
      } else if (period === 'May') {
         jobsQuery = jobsQuery.where('createdAt', '>=', new Date(now.getFullYear(), 4, 1)).where('createdAt', '<', new Date(now.getFullYear(), 5, 1));
      } else if (period === 'June') {
         jobsQuery = jobsQuery.where('createdAt', '>=', new Date(now.getFullYear(), 5, 1)).where('createdAt', '<', new Date(now.getFullYear(), 6, 1));
      } else {
         jobsQuery = jobsQuery.where('createdAt', '>=', dateFilter);
      }
    }

    const jobs = await jobsQuery
      .select(['id', 'budgetAmount', 'jobStatus'])
      .execute();

    let activeOrdersCount = 0;
    let activeOrdersValue = 0;
    let completedOrdersCount = 0;
    let completedOrdersValue = 0;

    for (const job of jobs) {
      const amount = Number(job.budgetAmount) || 0;
      if (job.jobStatus === 'IN_PROGRESS' || job.jobStatus === 'OPEN') {
        activeOrdersCount++;
        activeOrdersValue += amount;
      } else if (job.jobStatus === 'COMPLETED') {
        completedOrdersCount++;
        completedOrdersValue += amount;
      }
    }

    const avgSellingPrice = completedOrdersCount > 0 
      ? (completedOrdersValue / completedOrdersCount).toFixed(2) 
      : 0;

    // 3. Aggregate Earnings Data for the period
    let earningsQuery = db
      .selectFrom('earnings')
      .where('freelancerId', '=', freelancer.id);

    if (period !== 'All Time') {
       if (period === 'April') {
         earningsQuery = earningsQuery.where('createdAt', '>=', new Date(now.getFullYear(), 3, 1)).where('createdAt', '<', new Date(now.getFullYear(), 4, 1));
      } else if (period === 'May') {
         earningsQuery = earningsQuery.where('createdAt', '>=', new Date(now.getFullYear(), 4, 1)).where('createdAt', '<', new Date(now.getFullYear(), 5, 1));
      } else if (period === 'June') {
         earningsQuery = earningsQuery.where('createdAt', '>=', new Date(now.getFullYear(), 5, 1)).where('createdAt', '<', new Date(now.getFullYear(), 6, 1));
      } else {
         earningsQuery = earningsQuery.where('createdAt', '>=', dateFilter);
      }
    }

    const earningsRecords = await earningsQuery
      .selectAll()
      .orderBy('createdAt', 'desc')
      .limit(10) // Get the 10 most recent for the list
      .execute();

    // 4. Calculate overall totals (often independent of period filter for the top summary, 
    // but we can apply the period if requested)
    
    // For this implementation, we'll return both the all-time freelancer totals 
    // AND the period-specific totals.
    
    // Period specific earnings total
    let periodTotalEarnings = 0;
    let periodPending = 0;
    
    const allPeriodEarnings = await earningsQuery.select(['amount', 'status']).execute();
    for (const earning of allPeriodEarnings) {
        const amt = Number(earning.amount) || 0;
        periodTotalEarnings += amt;
        if (earning.status === 'PENDING') {
            periodPending += amt;
        }
    }
    
    // Get total withdrawn (from withdrawalRequests)
    let withdrawnQuery = db
      .selectFrom('withdrawalRequests')
      .where('freelancerId', '=', freelancer.id)
      .where('status', '=', 'PROCESSED');
      
    if (period !== 'All Time') {
        if (period === 'April') {
         withdrawnQuery = withdrawnQuery.where('processedAt', '>=', new Date(now.getFullYear(), 3, 1)).where('processedAt', '<', new Date(now.getFullYear(), 4, 1));
      } else if (period === 'May') {
         withdrawnQuery = withdrawnQuery.where('processedAt', '>=', new Date(now.getFullYear(), 4, 1)).where('processedAt', '<', new Date(now.getFullYear(), 5, 1));
      } else if (period === 'June') {
         withdrawnQuery = withdrawnQuery.where('processedAt', '>=', new Date(now.getFullYear(), 5, 1)).where('processedAt', '<', new Date(now.getFullYear(), 6, 1));
      } else {
         withdrawnQuery = withdrawnQuery.where('processedAt', '>=', dateFilter);
      }
    }
    
    const withdrawnRecords = await withdrawnQuery.select(['amount']).execute();
    let periodWithdrawn = 0;
    for (const w of withdrawnRecords) {
        periodWithdrawn += Number(w.amount) || 0;
    }

    const data = {
      period,
      analytics: {
        earningsInPeriod: periodTotalEarnings,
        avgSellingPrice: Number(avgSellingPrice),
        activeOrders: { count: activeOrdersCount, value: activeOrdersValue },
        completedOrders: { count: completedOrdersCount, value: completedOrdersValue },
        availableForWithdrawal: Number(freelancer.withdrawableAmount || 0) // Usually all-time
      },
      summary: {
        totalEarnings: periodTotalEarnings,
        withdrawn: periodWithdrawn,
        pending: periodPending,
        available: Number(freelancer.withdrawableAmount || 0)
      },
      recentEarnings: earningsRecords
    };

    return NextResponse.json({
      success: true,
      message: 'Earnings statistics retrieved successfully',
      data
    });

  } catch (error: any) {
    console.error('Get freelancer earnings stats error:', error);
    return NextResponse.json({
      success: false,
      message: error.message || 'Server error'
    }, { status: 500 });
  }
}
