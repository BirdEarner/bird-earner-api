import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> }
) {
    try {
        const { clientId } = await params;

        // Fetch ongoing jobs using Kysely to match the legacy logic
        // jobStatus in ['IN_PROGRESS', 'OPEN']
        const ongoingJobs = await db
            .selectFrom("jobs")
            .innerJoin("clients", "jobs.clientId", "clients.id")
            .leftJoin("freelancers", "jobs.assignedFreelancerId", "freelancers.id")
            .leftJoin("users as freelancerUser", "freelancers.userId", "freelancerUser.id")
            .leftJoin("services", "jobs.serviceId", "services.id")
            .select([
                "jobs.id",
                "jobs.jobTitle",
                "jobs.jobStatus",
                "jobs.deadlineDate",
                "jobs.assignedFreelancerId",
                "jobs.attachedFiles",
                "jobs.serviceId",
                "freelancerUser.fullName as freelancerFullName",
                "freelancers.profilePhoto as freelancerProfilePhoto",
                "services.name as serviceName",
                "services.category as serviceCategory",
                "services.description as serviceDescription",
                "services.imageUrl as serviceImageUrl",
                "services.isActive as serviceIsActive",
            ])
            .where("jobs.clientId", "=", clientId)
            .where("jobs.jobStatus", "in", ["IN_PROGRESS", "OPEN"])
            .orderBy("jobs.updatedAt", "desc")
            .limit(10)
            .execute();

        // Helper function to determine job color based on status and deadline
        const getJobColorByStatus = (status: string, deadline: Date | null) => {
            if (status === "COMPLETED") return "#34C759";
            if (status === "CANCELLED") return "#000";

            if (deadline) {
                const daysRemaining = Math.ceil(
                    (new Date(deadline).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
                );
                if (daysRemaining < 0) return "#000";
                if (daysRemaining <= 2) return "#FF3B30";
                if (daysRemaining <= 10) return "#FFCC00";
            }

            return "#34C759";
        };

        // Transform the data to match the expected format of the mobile app
        const transformedJobs = ongoingJobs.map((job) => ({
            jobDetails: {
                id: job.id,
                jobTitle: job.jobTitle,
                jobStatus: job.jobStatus,
                deadline: job.deadlineDate,
                assigned_freelancer: job.assignedFreelancerId,
                attachedFiles: job.attachedFiles,
                service: {
                    id: job.serviceId,
                    name: job.serviceName,
                    category: job.serviceCategory,
                    description: job.serviceDescription,
                    imageUrl: job.serviceImageUrl,
                    isActive: job.serviceIsActive,
                },
                $id: job.id,
            },
            full_name: job.freelancerFullName || "Unassigned",
            profile_photo: job.freelancerProfilePhoto || null,
            color: getJobColorByStatus(job.jobStatus, job.deadlineDate),
            freelancer_id: job.assignedFreelancerId,
        }));

        return NextResponse.json({
            success: true,
            message: "Ongoing jobs retrieved successfully",
            data: transformedJobs,
        });
    } catch (error: any) {
        console.error(`Failed to get ongoing jobs by client: ${error.message}`);
        return NextResponse.json(
            {
                success: false,
                message: "Failed to fetch ongoing jobs",
                error: error.message,
            },
            { status: 500 }
        );
    }
}
