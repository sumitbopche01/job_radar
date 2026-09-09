import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, jobs } from "../db/schema.js";
import { eligibilityClause } from "./eligibility.js";
import { roleTargetClause } from "./roles.js";

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
  // hardware / silicon / electrical (not software roles)
  "asic",
  "fpga",
  "vlsi",
  "silicon",
  "semiconductor",
  "physical design",
  "package layout",
  "layout engineer",
  "signal integrity",
  "power integrity",
  "thermal",
  "hardware engineer",
  "hardware qa",
  "hwqa",
  "gpu architect",
  "fabrics",
  "pcb",
  "board design",
  "firmware", // remove this line if you want embedded/firmware roles
  "robotics",
  // QA / test / validation (not software engineering)
  "test engineer",
  "test developer",
  "sdet",
  "qa engineer",
  "quality assurance",
  "validation engineer",
  "verification engineer",
  // field / support engineering (customer-facing, not IC software)
  "field engineer",
  "field application",
  "technical services",
];

/** SQL: title passes the denylist, keyed to a table alias. */
export function titleBlocklistClause(alias = "jobs") {
  const title = `lower(coalesce(${alias}.title, ''))`;
  return sql.raw(
    "not (" + TITLE_BLOCKLIST.map((t) => `${title} like '%${t.toLowerCase()}%'`).join(" or ") + ")",
  );
}

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
        or(gte(jobs.postedAt, since), gte(jobs.firstSeenAt, since)),
        eligibilityClause("jobs"),
        roleTargetClause("jobs"),
        ...notBlocked,
      ),
    )
    .orderBy(desc(sql`coalesce(${jobs.postedAt}, ${jobs.firstSeenAt})`))
    .limit(limit);

  return rows;
}
