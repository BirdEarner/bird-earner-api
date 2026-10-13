/**
 * Single source of truth for whether a job is on-site.
 *
 * projectType is free text from the app ("On-site", "on-site", "Onsite"...), so it is normalised
 * here instead of compared as an exact string in each route.
 */
export function isOnSiteJob(job: { projectType?: string | null; location?: string | null }): boolean {
    const type = (job.projectType || '').toLowerCase().replace(/[^a-z]/g, '');
    if (type.includes('remote')) return false;
    if (type.includes('site')) return true;
    // Unknown project type: fall back to the location (anything that isn't remote is on-site)
    return !(job.location || '').toLowerCase().includes('remote');
}
