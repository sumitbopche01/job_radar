import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { applications, companies, feedback, jobResearch, jobs } from "../db/schema.js";
import { TITLE_BLOCKLIST } from "../filters/stage0.js";
import { eligibilityClause } from "../filters/eligibility.js";
import { roleTargetClause } from "../filters/roles.js";
import { regionClause, type Region } from "../filters/region.js";

const notBlockedTitle = () =>
  TITLE_BLOCKLIST.map(
    (term) => sql`lower(${jobs.title}) not like ${"%" + term.toLowerCase() + "%"}`,
  );

export interface TriageJob {
  id: string;
  title: string;
  companyName: string;
  locationRaw: string | null;
  remoteType: string;
  employmentType: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  postedAt: Date | null;
  firstSeenAt: Date;
  applyUrl: string;
  source: string;
  descriptionMd: string;
  score: number | null;
  rubric: unknown;
  researchContacts: unknown;
  researchSummary: string | null;
}

export interface TriageOptions {
  limit?: number;
  sinceDays?: number;
  /** when set, join that profile's stage-2 score/rubric and order by score first */
  profileLabel?: string;
  /** when set, restrict to a geographic region (india/europe/uae/singapore/remote) */
  region?: Region;
}

/**
 * The triage queue: open, canonical, fresh jobs that haven't been actioned yet
 * (no feedback row and no application row). Ordered by the profile's fit score
 * when a profile is given (P2), else newest-first. Descriptions are included so
 * keyboard nav needs no round-trips.
 */
export async function getTriageQueue(db: Db, opts: TriageOptions = {}): Promise<TriageJob[]> {
  const limit = opts.limit ?? 50;
  const sinceDays = opts.sinceDays ?? 14;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const label = opts.profileLabel ?? null;

  const scoreExpr = sql<number | null>`(
    select js.score from job_scores js join profiles p on p.id = js.profile_id
    where js.job_id = ${jobs.id} and js.stage = 's2' and p.label = ${label}
  )`;
  const rubricExpr = sql<unknown>`(
    select js.rubric from job_scores js join profiles p on p.id = js.profile_id
    where js.job_id = ${jobs.id} and js.stage = 's2' and p.label = ${label}
  )`;

  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      companyName: companies.name,
      locationRaw: jobs.locationRaw,
      remoteType: jobs.remoteType,
      employmentType: jobs.employmentType,
      salaryMin: jobs.salaryMin,
      salaryMax: jobs.salaryMax,
      salaryCurrency: jobs.salaryCurrency,
      postedAt: jobs.postedAt,
      firstSeenAt: jobs.firstSeenAt,
      applyUrl: jobs.applyUrl,
      source: jobs.source,
      descriptionMd: jobs.descriptionMd,
      score: label ? scoreExpr : sql<number | null>`null`,
      rubric: label ? rubricExpr : sql<unknown>`null`,
      researchContacts: jobResearch.contacts,
      researchSummary: jobResearch.summary,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .leftJoin(jobResearch, eq(jobResearch.jobId, jobs.id))
    .where(
      and(
        isNull(jobs.closedAt),
        isNull(jobs.canonicalJobId),
        or(gte(jobs.postedAt, since), gte(jobs.firstSeenAt, since)),
        sql`not exists (select 1 from ${feedback} f where f.job_id = ${jobs.id})`,
        sql`not exists (select 1 from ${applications} a where a.job_id = ${jobs.id})`,
        eligibilityClause("jobs"),

        roleTargetClause("jobs"),


        opts.region ? regionClause(opts.region, "jobs") : undefined,
        ...notBlockedTitle(),
      ),
    )
    .orderBy(
      label
        ? sql`${scoreExpr} desc nulls last`
        : desc(sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`),
    )
    .limit(limit);
  return rows as TriageJob[];
}

/** How many jobs are waiting in the queue (for the header count). */
export async function getTriageCount(db: Db, opts: TriageOptions = {}): Promise<number> {
  const sinceDays = opts.sinceDays ?? 14;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(jobs)
    .where(
      and(
        isNull(jobs.closedAt),
        isNull(jobs.canonicalJobId),
        or(gte(jobs.postedAt, since), gte(jobs.firstSeenAt, since)),
        sql`not exists (select 1 from ${feedback} f where f.job_id = ${jobs.id})`,
        sql`not exists (select 1 from ${applications} a where a.job_id = ${jobs.id})`,
        eligibilityClause("jobs"),

        roleTargetClause("jobs"),


        opts.region ? regionClause(opts.region, "jobs") : undefined,
        ...notBlockedTitle(),
      ),
    );
  return row?.n ?? 0;
}

// ---- actions ----

/** Shortlist: record positive feedback and open an application in `shortlist`. */
export async function shortlistJob(db: Db, jobId: string): Promise<void> {
  await db.insert(feedback).values({ jobId, label: "up", reason: "shortlist" });
  await upsertApplication(db, jobId, "shortlist");
}

/** Reject: record negative feedback (training signal) with an optional reason. */
export async function rejectJob(db: Db, jobId: string, reason?: string): Promise<void> {
  await db.insert(feedback).values({ jobId, label: "down", reason: reason ?? null });
}

/** Mark applied: positive feedback + application in `applied` with a timestamp. */
export async function markApplied(db: Db, jobId: string): Promise<void> {
  await db.insert(feedback).values({ jobId, label: "up", reason: "applied" });
  await upsertApplication(db, jobId, "applied", new Date());
}

async function upsertApplication(
  db: Db,
  jobId: string,
  status: "new" | "shortlist" | "applied" | "screen" | "interview" | "offer" | "rejected",
  appliedAt?: Date,
): Promise<void> {
  await db
    .insert(applications)
    .values({ jobId, status, appliedAt: appliedAt ?? null })
    .onConflictDoUpdate({
      target: applications.jobId,
      set: {
        status,
        updatedAt: new Date(),
        ...(appliedAt ? { appliedAt } : {}),
      },
    });
}
