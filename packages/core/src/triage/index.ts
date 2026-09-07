import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { applications, companies, feedback, jobs } from "../db/schema.js";
import { TITLE_BLOCKLIST } from "../filters/stage0.js";

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
}

export interface TriageOptions {
  limit?: number;
  sinceDays?: number;
}

/**
 * The triage queue: open, canonical, fresh jobs that haven't been actioned yet
 * (no feedback row and no application row). Ordered newest-first. Descriptions are
 * included so keyboard nav needs no round-trips.
 */
export async function getTriageQueue(db: Db, opts: TriageOptions = {}): Promise<TriageJob[]> {
  const limit = opts.limit ?? 50;
  const sinceDays = opts.sinceDays ?? 14;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  return db
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
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(
      and(
        isNull(jobs.closedAt),
        isNull(jobs.canonicalJobId),
        or(gte(jobs.postedAt, since), and(isNull(jobs.postedAt), gte(jobs.firstSeenAt, since))),
        sql`not exists (select 1 from ${feedback} f where f.job_id = ${jobs.id})`,
        sql`not exists (select 1 from ${applications} a where a.job_id = ${jobs.id})`,
        ...notBlockedTitle(),
      ),
    )
    .orderBy(desc(sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`))
    .limit(limit);
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
        or(gte(jobs.postedAt, since), and(isNull(jobs.postedAt), gte(jobs.firstSeenAt, since))),
        sql`not exists (select 1 from ${feedback} f where f.job_id = ${jobs.id})`,
        sql`not exists (select 1 from ${applications} a where a.job_id = ${jobs.id})`,
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
