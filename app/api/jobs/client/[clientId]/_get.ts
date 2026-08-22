import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ clientId: string }> }
) {
    try {
        const { clientId } = await params;

        if (!clientId) {
            return NextResponse.json(
                { success: false, message: "Client ID is required" },
                { status: 400 }
            );
        }

        const { searchParams } = new URL(request.url);
        const page = parseInt(searchParams.get("page") || "1");
        const limit = parseInt(searchParams.get("limit") || "10");
        const status = searchParams.get("status");

        const offset = (page - 1) * limit;

        // Calculate 3 days ago for cancelled job visibility
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);

        let query = db
            .selectFrom("jobs")
            .selectAll("jobs")
            .where("clientId", "=", clientId)
            .where("deleted", "=", false)
            .where((eb) =>
                eb.or([
                    eb("jobStatus", "!=", "CANCELLED"),
                    eb.and([
                        eb("jobStatus", "=", "CANCELLED"),
                        eb("cancelledAt", ">=", threeDaysAgo)
                    ])
                ])
            );

        if (status) {
            query = query.where("jobStatus", "=", status.toUpperCase() as any);
        }

        const [jobs, totalResult] = await Promise.all([
            query
                .orderBy("createdAt", "desc")
                .limit(limit)
                .offset(offset)
                .execute(),
            db
                .selectFrom("jobs")
                .select(db.fn.count("id").as("count"))
                .where("clientId", "=", clientId)
                .where("deleted", "=", false)
                .where((eb) =>
                    eb.or([
                        eb("jobStatus", "!=", "CANCELLED"),
                        eb.and([
                            eb("jobStatus", "=", "CANCELLED"),
                            eb("cancelledAt", ">=", threeDaysAgo)
                        ])
                    ])
                )
                .$if(!!status, (qb) => qb.where("jobStatus", "=", status?.toUpperCase() as any))
                .executeTakeFirst(),
        ]);

        const total = Number(totalResult?.count || 0);
        const totalPages = Math.ceil(total / limit);

        // Live applicant counts from chat threads (proposalCount column is not maintained)
        const jobIds = jobs.map((job) => job.id);
        const applicantCountRows = jobIds.length
            ? await db
                .selectFrom("chatThreads")
                .select(["jobId", db.fn.count("id").as("count")])
                .where("jobId", "in", jobIds)
                .groupBy("jobId")
                .execute()
            : [];
        const applicantCountsByJobId = applicantCountRows.reduce<Record<string, number>>(
            (acc, row) => {
                if (row.jobId) {
                    acc[row.jobId] = Number(row.count || 0);
                }
                return acc;
            },
            {}
        );

        // Fetch related data for all jobs
        const enhancedJobs = await Promise.all(
            jobs.map(async (job) => {
                let assignedFreelancer = null;
                if (job.assignedFreelancerId) {
                    const freelancerResult = await db
                        .selectFrom("freelancers as fp")
                        .innerJoin("users as u", "u.id", "fp.userId")
                        .select([
                            "fp.id",
                            "u.id as userId",
                            "u.fullName",
                            "u.email",
                            "fp.rating",
                            "fp.profilePhoto",
                            "fp.experience"
                        ])
                        .where("fp.id", "=", job.assignedFreelancerId)
                        .executeTakeFirst();

                    if (freelancerResult) {
                        assignedFreelancer = {
                            id: freelancerResult.id,
                            userId: freelancerResult.userId,
                            user: {
                                id: freelancerResult.userId,
                                fullName: freelancerResult.fullName,
                                email: freelancerResult.email
                            },
                            profilePhoto: freelancerResult.profilePhoto,
                            rating: freelancerResult.rating,
                            experience: freelancerResult.experience
                        }
                    }
                }

                let service = null;
                if (job.serviceId) {
                    service = await db
                        .selectFrom("services")
                        .select([
                            "id",
                            "name",
                            "category",
                            "description",
                            "imageUrl",
                            "isActive"
                        ])
                        .where("id", "=", job.serviceId)
                        .executeTakeFirst() || null;
                }

                const proposalCount = applicantCountsByJobId[job.id] ?? 0;

                return {
                    ...job,
                    proposalCount,
                    applicantsCount: proposalCount,
                    assignedFreelancer,
                    service
                };
            })
        );

        return NextResponse.json({
            success: true,
            message: "Client jobs retrieved successfully",
            data: {
                jobs: enhancedJobs,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalCount: total,
                    limit
                }
            }
        });
    } catch (error: any) {
        console.error("Error fetching client jobs:", error);
        return NextResponse.json(
            { success: false, message: error.message || "Failed to fetch client jobs" },
            { status: 500 }
        );
    }
}
