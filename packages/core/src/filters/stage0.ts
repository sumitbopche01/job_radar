import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, jobs } from "../db/schema.js";

/** Titles that are never relevant — kills ~most of the noise for free (design doc §7). */
export const TITLE_BLOCKLIST = [
  "sales",
  "account executive",
  "account manager",
  "customer success",
  "customer support",
  "support engineer",
  "technical support",
  "recruiter",
  "recruiting",
  "talent acquisition",
  "data entry",
  "administrative",
  "office manager",
  "marketing manager",
  "product marketing",
  "solutions engineer",
  "sales engineer",
  "business development",
  "intern",
  "internship",
  "graduate",
  "new grad",
  "junior",
  "receptionist",
  "accountant",
  "bookkeeper",
  "executive assistant",
  "chief of staff",
  "solutions architect",
  "sourcing",
  "procurement",
  "counsel",
  "paralegal",
  "treasury",
  "controller",
  "product manager",
  "engineering manager",
  "program manager",
  "project manager",
  "director",
  "vice president",
  "head of",
];

export interface Stage0Options {
  sinceDays?: number; // posted within N days
  limit?: number;
  blocklist?: string[];
}

export interface Stage0Job {
  id: string;
  title: string;
  companyName: string;
  locationRaw: string | null;
  remoteType: string;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  postedAt: Date | null;
  firstSeenAt: Date;
  applyUrl: string;
  source: string;
}

/**
 * Stage-0: cheap SQL gate. Open, canonical (non-duplicate), fresh, title not
 * blocklisted. This runs before any LLM work — it's what keeps the bill near zero.
 */
export async function stage0Candidates(db: Db, opts: Stage0Options = {}): Promise<Stage0Job[]> {
  const sinceDays = opts.sinceDays ?? 7;
  const limit = opts.limit ?? 50;
  const blocklist = opts.blocklist ?? TITLE_BLOCKLIST;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);

  const notBlocked = blocklist.map((term) => sql`lower(${jobs.title}) not like ${"%" + term.toLowerCase() + "%"}`);

  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      companyName: companies.name,
      locationRaw: jobs.locationRaw,
      remoteType: jobs.remoteType,
      salaryMin: jobs.salaryMin,
      salaryMax: jobs.salaryMax,
      salaryCurrency: jobs.salaryCurrency,
      postedAt: jobs.postedAt,
      firstSeenAt: jobs.firstSeenAt,
      applyUrl: jobs.applyUrl,
      source: jobs.source,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(
      and(
        isNull(jobs.closedAt),
        isNull(jobs.canonicalJobId), // only winners, not duplicate pointers
        // fresh: posted recently, or (no posted date) first seen recently
        or(gte(jobs.postedAt, since), and(isNull(jobs.postedAt), gte(jobs.firstSeenAt, since))),
        ...notBlocked,
      ),
    )
    .orderBy(desc(sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`))
    .limit(limit);

  return rows;
}
