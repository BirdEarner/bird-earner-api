import { db } from '../db';

export interface PriorityConfig {
    immediate: number;
    high: number;
    standard: number;
}

const DEFAULT_PRIORITY_CONFIG: PriorityConfig = {
    immediate: 172800, // 2 days
    high: 345600,      // 4 days
    standard: 999999999
};

export async function calculateJobPriority(
    deadlineDate: Date | string | null,
    config: PriorityConfig = DEFAULT_PRIORITY_CONFIG
): Promise<'Immediate' | 'High' | 'Standard'> {
    if (!deadlineDate) return 'Standard';

    const deadline = typeof deadlineDate === 'string' ? new Date(deadlineDate) : deadlineDate;
    if (isNaN(deadline.getTime())) return 'Standard';

    const currentTime = new Date();
    const timeDifferenceSeconds = Math.floor((deadline.getTime() - currentTime.getTime()) / 1000);

    if (timeDifferenceSeconds <= config.immediate) return 'Immediate';
    if (timeDifferenceSeconds <= config.high) return 'High';
    return 'Standard';
}

export async function categorizeJobsByPriority(jobs: any[], serviceId: string | null = null) {
    const categorizedJobs: Record<string, any[]> = {
        Immediate: [],
        High: [],
        Standard: []
    };

    let priorityConfig = { ...DEFAULT_PRIORITY_CONFIG };

    if (serviceId) {
        const service = await db
            .selectFrom('services')
            .select('priorityConfig')
            .where('id', '=', serviceId)
            .executeTakeFirst();

        if (service?.priorityConfig) {
            priorityConfig = { ...priorityConfig, ...(service.priorityConfig as any) };
        }
    }

    const jobsWithPriorities = jobs.map((job) => {
        const priority = calculateJobPrioritySync(job.deadlineDate, priorityConfig);
        return { ...job, priority };
    });

    jobsWithPriorities.forEach((job) => {
        if (categorizedJobs[job.priority]) {
            categorizedJobs[job.priority].push(job);
        } else {
            categorizedJobs.Standard.push(job);
        }
    });

    return categorizedJobs;
}

function calculateJobPrioritySync(
    deadlineDate: Date | string | null,
    config: PriorityConfig
): 'Immediate' | 'High' | 'Standard' {
    if (!deadlineDate) return 'Standard';

    const deadline = typeof deadlineDate === 'string' ? new Date(deadlineDate) : deadlineDate;
    if (isNaN(deadline.getTime())) return 'Standard';

    const currentTime = new Date();
    const timeDifferenceSeconds = Math.floor((deadline.getTime() - currentTime.getTime()) / 1000);

    if (timeDifferenceSeconds <= config.immediate) return 'Immediate';
    if (timeDifferenceSeconds <= config.high) return 'High';
    return 'Standard';
}
