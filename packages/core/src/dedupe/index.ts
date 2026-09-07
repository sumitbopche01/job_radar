import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, jobs } from "../db/schema.js";
import { dedupeKey } from "../util/normalize.js";

interface Candidate {
  id: string;
  source: string;
  title: string;
  companyName: string;
  locationRaw: string | null;
  remoteType: string;
  descLen: number;
  firstSeenAt: Date;
}

// Winner priority: richest ATS record wins. All current sources are ATS, so
// selection falls back to longest description, then earliest first_seen, then id.
export interface DedupeResult {
  groups: number;
  duplicatesLinked: number;
}

/**
 * Deterministic cross-source dedupe. Groups open, not-yet-canonicalized jobs by
 * (company, title, location bucket); the best record stays canonical and the rest
 * point at it via canonical_job_id. Never hard-deletes.
 */
export async function dedupe(db: Db): Promise<DedupeResult> {
  const rows = await db
    .select({
      id: jobs.id,
      source: jobs.source,
      title: jobs.title,
      companyName: companies.name,
      locationRaw: jobs.locationRaw,
      remoteType: jobs.remoteType,
      descriptionMd: jobs.descriptionMd,
      firstSeenAt: jobs.firstSeenAt,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(and(isNull(jobs.closedAt), isNull(jobs.canonicalJobId)));

  const buckets = new Map<string, Candidate[]>();
  for (const r of rows) {
    const key = dedupeKey(r.companyName, r.title, r.locationRaw, r.remoteType);
    const c: Candidate = {
      id: r.id,
      source: r.source,
      title: r.title,
      companyName: r.companyName,
      locationRaw: r.locationRaw,
      remoteType: r.remoteType,
      descLen: r.descriptionMd?.length ?? 0,
      firstSeenAt: r.firstSeenAt,
    };
    const arr = buckets.get(key);
    if (arr) arr.push(c);
    else buckets.set(key, [c]);
  }

  let duplicatesLinked = 0;
  let groups = 0;
  for (const arr of buckets.values()) {
    if (arr.length < 2) continue;
    groups++;
    const winner = pickWinner(arr);
    for (const c of arr) {
      if (c.id === winner.id) continue;
      await db
        .update(jobs)
        .set({ canonicalJobId: winner.id })
        .where(eq(jobs.id, c.id));
      duplicatesLinked++;
    }
  }

  return { groups, duplicatesLinked };
}

function pickWinner(arr: Candidate[]): Candidate {
  return [...arr].sort((a, b) => {
    if (b.descLen !== a.descLen) return b.descLen - a.descLen;
    const t = a.firstSeenAt.getTime() - b.firstSeenAt.getTime();
    if (t !== 0) return t;
    return a.id < b.id ? -1 : 1;
  })[0]!;
}
