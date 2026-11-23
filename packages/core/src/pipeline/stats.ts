import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, jobs } from "../db/schema.js";
import { eligibilityClause } from "../filters/eligibility.js";
import { roleTargetClause } from "../filters/roles.js";
import { titleBlocklistClause } from "../filters/stage0.js";
import { gigExclusionClause } from "../filters/gig.js";
import { regionClause } from "../filters/region.js";
import { usContractEligibleSql, usPinnedSql, usStrictSql } from "../filters/usRemote.js";

export interface Stats {
  companies: number;
  companiesActive: number;
  companiesStale: number;
  jobsOpen: number;
  jobsEligible: number;
  jobsTargeted: number;
  /** US-remote funnel (open + canonical + remote): pinned → contract-friendly → targeted */
  usPinned: number;
  usStrict: number;
  usContract: number;
  usTargeted: number;
  jobsClosed: number;
  jobsDuplicates: number;
  newLast24h: number;
  bySource: Record<string, number>;
}

export async function getStats(db: Db): Promise<Stats> {
  const [c] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where status = 'active')::int`,
      stale: sql<number>`count(*) filter (where status = 'stale')::int`,
    })
    .from(companies);

  const [j] = await db
    .select({
      open: sql<number>`count(*) filter (where closed_at is null and canonical_job_id is null)::int`,
      eligible: sql<number>`count(*) filter (where closed_at is null and canonical_job_id is null and ${eligibilityClause("jobs")})::int`,
      targeted: sql<number>`count(*) filter (where closed_at is null and canonical_job_id is null and ${eligibilityClause("jobs")} and ${roleTargetClause("jobs")} and ${titleBlocklistClause("jobs")} and ${gigExclusionClause("jobs")})::int`,
      usPinned: sql<number>`count(*) filter (where closed_at is null and canonical_job_id is null and remote_type = 'remote' and ${sql.raw(usPinnedSql("jobs"))})::int`,
      usStrict: sql<number>`count(*) filter (where closed_at is null and canonical_job_id is null and remote_type = 'remote' and ${sql.raw(usPinnedSql("jobs"))} and ${sql.raw(usStrictSql("jobs"))})::int`,
      usContract: sql<number>`count(*) filter (where closed_at is null and canonical_job_id is null and ${sql.raw(usContractEligibleSql("jobs"))})::int`,
      usTargeted: sql<number>`count(*) filter (where closed_at is null and canonical_job_id is null and ${regionClause("usa", "jobs")} and ${eligibilityClause("jobs")} and ${roleTargetClause("jobs")} and ${titleBlocklistClause("jobs")} and ${gigExclusionClause("jobs")})::int`,
      closed: sql<number>`count(*) filter (where closed_at is not null)::int`,
      dupes: sql<number>`count(*) filter (where canonical_job_id is not null)::int`,
      new24: sql<number>`count(*) filter (where first_seen_at > now() - interval '24 hours')::int`,
    })
    .from(jobs);

  const sources = await db
    .select({ source: jobs.source, n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(sql`closed_at is null and canonical_job_id is null`)
    .groupBy(jobs.source);

  return {
    companies: c?.total ?? 0,
    companiesActive: c?.active ?? 0,
    companiesStale: c?.stale ?? 0,
    jobsOpen: j?.open ?? 0,
    jobsEligible: j?.eligible ?? 0,
    jobsTargeted: j?.targeted ?? 0,
    usPinned: j?.usPinned ?? 0,
    usStrict: j?.usStrict ?? 0,
    usContract: j?.usContract ?? 0,
    usTargeted: j?.usTargeted ?? 0,
    jobsClosed: j?.closed ?? 0,
    jobsDuplicates: j?.dupes ?? 0,
    newLast24h: j?.new24 ?? 0,
    bySource: Object.fromEntries(sources.map((s) => [s.source, s.n])),
  };
}
