import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, jobs, rawPostings } from "../db/schema.js";
import { getAdapter } from "../adapters/index.js";
import type { CanonicalJob, CrawlTarget } from "../types.js";
import { hashJson } from "../util/hash.js";

export interface CrawlResult {
  company: string;
  source: string;
  ok: boolean;
  fetched: number;
  inserted: number;
  contentUpdated: number;
  reopened: number;
  unchanged: number;
  closed: number;
  error?: string;
}

const CLOSE_AFTER_MISSES = 2; // absent for N consecutive crawls -> soft close

/** salary columns are integer; some ATS report fractional/hourly rates. */
function toInt(n: number | null | undefined): number | null {
  if (n == null || !Number.isFinite(n)) return null;
  return Math.round(n);
}

/** Crawl one company end to end. Adapters fetch+normalize; the pipeline owns the DB. */
export async function crawlCompany(db: Db, target: CrawlTarget): Promise<CrawlResult> {
  const adapter = getAdapter(target.provider);
  const base: CrawlResult = {
    company: target.companyName,
    source: target.provider,
    ok: false,
    fetched: 0,
    inserted: 0,
    contentUpdated: 0,
    reopened: 0,
    unchanged: 0,
    closed: 0,
  };
  if (!adapter) return { ...base, error: `no adapter for provider "${target.provider}"` };

  let raws;
  try {
    raws = await adapter.fetch(target);
  } catch (err) {
    await recordFailure(db, target.companyId);
    return { ...base, error: err instanceof Error ? err.message : String(err) };
  }

  const now = new Date();
  const normalized: CanonicalJob[] = [];
  for (const raw of raws) {
    // 1) store raw immutably (append-on-change, keyed by payload hash)
    const payloadHash = hashJson(raw.payload);
    await db
      .insert(rawPostings)
      .values({
        source: raw.source,
        externalId: raw.externalId,
        companyId: target.companyId,
        payload: raw.payload as object,
        contentHash: payloadHash,
      })
      .onConflictDoNothing({
        target: [rawPostings.source, rawPostings.externalId, rawPostings.contentHash],
      });
    // 2) normalize
    normalized.push(adapter.normalize(raw, target));
  }

  base.fetched = normalized.length;

  // Pre-read existing (external_id -> {contentHash, closed}) to classify writes.
  const seenIds = normalized.map((j) => j.externalId);
  const existing =
    seenIds.length > 0
      ? await db
          .select({
            externalId: jobs.externalId,
            contentHash: jobs.contentHash,
            closedAt: jobs.closedAt,
          })
          .from(jobs)
          .where(and(eq(jobs.source, adapter.id), inArray(jobs.externalId, seenIds)))
      : [];
  const existingMap = new Map(existing.map((e) => [e.externalId, e]));

  for (const j of normalized) {
    const prev = existingMap.get(j.externalId);
    if (!prev) base.inserted++;
    else if (prev.contentHash !== j.contentHash) base.contentUpdated++;
    else base.unchanged++;
    if (prev?.closedAt) base.reopened++;

    await db
      .insert(jobs)
      .values({
        companyId: target.companyId,
        source: j.source,
        externalId: j.externalId,
        title: j.title,
        descriptionMd: j.descriptionMd,
        locationRaw: j.locationRaw,
        remoteType: j.remoteType,
        employmentType: j.employmentType,
        salaryMin: toInt(j.salaryMin) ?? undefined,
        salaryMax: toInt(j.salaryMax) ?? undefined,
        salaryCurrency: j.salaryCurrency,
        postedAt: j.postedAt,
        applyUrl: j.applyUrl,
        contentHash: j.contentHash,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [jobs.source, jobs.externalId],
        // firstSeenAt is intentionally NOT updated — it's the freshness signal.
        set: {
          title: j.title,
          descriptionMd: j.descriptionMd,
          locationRaw: j.locationRaw,
          remoteType: j.remoteType,
          employmentType: j.employmentType,
          salaryMin: toInt(j.salaryMin),
          salaryMax: toInt(j.salaryMax),
          salaryCurrency: j.salaryCurrency,
          postedAt: j.postedAt,
          applyUrl: j.applyUrl,
          contentHash: j.contentHash,
          lastSeenAt: now,
          closedAt: null,
          consecutiveMisses: 0,
        },
      });
  }

  // Soft-close: only when the fetch actually returned jobs (an empty board is
  // likely an outage, not a mass closure). Bump miss counter on absent open jobs;
  // close once they've missed CLOSE_AFTER_MISSES consecutive crawls.
  if (normalized.length > 0) {
    const missed = await db
      .update(jobs)
      .set({
        consecutiveMisses: sql`${jobs.consecutiveMisses} + 1`,
        closedAt: sql`CASE WHEN ${jobs.consecutiveMisses} + 1 >= ${CLOSE_AFTER_MISSES} THEN now() ELSE ${jobs.closedAt} END`,
      })
      .where(
        and(
          eq(jobs.companyId, target.companyId),
          eq(jobs.source, adapter.id),
          isNull(jobs.closedAt),
          seenIds.length > 0 ? notInArray(jobs.externalId, seenIds) : undefined,
        ),
      )
      .returning({ closedAt: jobs.closedAt });
    base.closed = missed.filter((m) => m.closedAt != null).length;
  }

  await recordSuccess(db, target.companyId);
  base.ok = true;
  return base;
}

async function recordSuccess(db: Db, companyId: string) {
  await db
    .update(companies)
    .set({ lastOkAt: new Date(), consecutiveFailures: 0, status: "active" })
    .where(eq(companies.id, companyId));
}

async function recordFailure(db: Db, companyId: string) {
  const [row] = await db
    .update(companies)
    .set({ consecutiveFailures: sql`${companies.consecutiveFailures} + 1` })
    .where(eq(companies.id, companyId))
    .returning({ failures: companies.consecutiveFailures });
  // 7 consecutive failures -> mark stale (drops to weekly polling by the scheduler).
  if (row && row.failures >= 7) {
    await db.update(companies).set({ status: "stale" }).where(eq(companies.id, companyId));
  }
}
