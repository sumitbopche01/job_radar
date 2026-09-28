import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, jobScores, jobs } from "../db/schema.js";
import { TITLE_BLOCKLIST, titleRegexExclusionSql } from "../filters/stage0.js";
import { eligibilityClause } from "../filters/eligibility.js";
import { roleTargetClause } from "../filters/roles.js";
import { getProfile } from "../profiles/index.js";

export type EvalLabel = "yes" | "no" | "borderline" | "";

export interface EvalItem {
  company: string;
  title: string;
  applyUrl: string;
  label: EvalLabel;
  reason?: string;
}

/**
 * Scaffold an eval set: pick N fresh candidate jobs for the user to hand-label
 * (design doc §7 wants ~50: 15 yes / 25 no / 10 borderline). Labels start blank.
 */
export async function scaffoldEvalSet(db: Db, n = 50, sinceDays = 30): Promise<EvalItem[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const notBlocked = TITLE_BLOCKLIST.map(
    (t) => sql`lower(${jobs.title}) not like ${"%" + t.toLowerCase() + "%"}`,
  );
  // spread across companies via a pseudo-random order so the set isn't all one board
  const rows = await db
    .select({ title: jobs.title, companyName: companies.name, applyUrl: jobs.applyUrl })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(
      and(
        isNull(jobs.closedAt),
        isNull(jobs.canonicalJobId),
        or(gte(jobs.postedAt, since), gte(jobs.firstSeenAt, since)),
        eligibilityClause("jobs"),
        roleTargetClause("jobs"),
        titleRegexExclusionSql("jobs"),
        ...notBlocked,
      ),
    )
    .orderBy(sql`md5(${jobs.id}::text)`)
    .limit(n);
  return rows.map((r) => ({ company: r.companyName, title: r.title, applyUrl: r.applyUrl, label: "" as EvalLabel }));
}

export interface EvalReport {
  profile: string;
  labeled: number;
  scored: number;
  yesCount: number;
  precisionAt: Record<number, number>;
  ranking: { title: string; company: string; label: EvalLabel; score: number | null }[];
}

/**
 * Run the eval: match labeled items to their stage-2 scores, rank by score, and
 * compute precision@k. precision@k = (# labeled "yes" in the top k) / k.
 */
export async function runEval(
  db: Db,
  profileLabel: string,
  items: EvalItem[],
  ks: number[] = [5, 10],
): Promise<EvalReport> {
  const profile = await getProfile(db, profileLabel);
  if (!profile) throw new Error(`no profile "${profileLabel}"`);

  const labeled = items.filter((i) => i.label === "yes" || i.label === "no" || i.label === "borderline");
  const urls = labeled.map((i) => i.applyUrl);

  const scoreRows =
    urls.length > 0
      ? await db
          .select({ applyUrl: jobs.applyUrl, score: jobScores.score })
          .from(jobs)
          .innerJoin(
            jobScores,
            and(eq(jobScores.jobId, jobs.id), eq(jobScores.profileId, profile.id), eq(jobScores.stage, "s2")),
          )
          .where(inArray(jobs.applyUrl, urls))
      : [];
  const scoreMap = new Map(scoreRows.map((r) => [r.applyUrl, r.score]));

  const ranking = labeled
    .map((i) => ({
      title: i.title,
      company: i.company,
      label: i.label,
      score: scoreMap.get(i.applyUrl) ?? null,
    }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const scored = ranking.filter((r) => r.score != null);
  const precisionAt: Record<number, number> = {};
  for (const k of ks) {
    const topK = scored.slice(0, k);
    const yes = topK.filter((r) => r.label === "yes").length;
    precisionAt[k] = topK.length ? yes / topK.length : 0;
  }

  return {
    profile: profileLabel,
    labeled: labeled.length,
    scored: scored.length,
    yesCount: labeled.filter((i) => i.label === "yes").length,
    precisionAt,
    ranking,
  };
}
