import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, jobs } from "../db/schema.js";
import type { RemoteType } from "../types.js";
import { sha256 } from "../util/hash.js";
import { normalizeCompany } from "../util/normalize.js";

/** A posting from a non-ATS source (HN thread, email alert). A discovery pointer. */
export interface Posting {
  company: string;
  title: string;
  location?: string | null;
  remoteType?: RemoteType;
  applyUrl: string;
  descriptionMd?: string;
  externalId: string; // stable within the source
  postedAt?: Date | null;
}

export interface IngestResult {
  processed: number;
  companies: number;
  inserted: number;
  updated: number;
  skipped: number;
}

/**
 * Ingest non-ATS postings as `jobs` rows under an `external` company (one per
 * company name). The crawl skips external companies (no adapter), but the geo/role
 * gates, dedupe, triage and digest all treat them like any other job. Idempotent
 * by (source, external_id). Per design §4, these are also discovery signal — the
 * company can later be resolved to its real ATS by the discovery pipeline.
 */
export async function ingestPostings(
  db: Db,
  source: string,
  postings: Posting[],
): Promise<IngestResult> {
  const res: IngestResult = { processed: postings.length, companies: 0, inserted: 0, updated: 0, skipped: 0 };
  const companyIds = new Map<string, string>();
  const now = new Date();

  for (const p of postings) {
    const token = normalizeCompany(p.company);
    const title = p.title.trim();
    if (!token || !title || !p.applyUrl) {
      res.skipped++;
      continue;
    }

    // upsert the external company (deduped by normalized name)
    let companyId = companyIds.get(token);
    if (!companyId) {
      const [row] = await db
        .insert(companies)
        .values({
          name: p.company.trim(),
          atsProvider: "external",
          boardToken: token,
          status: "active",
          discoveredVia: source,
        })
        .onConflictDoUpdate({
          target: [companies.atsProvider, companies.boardToken],
          set: { name: sql`excluded.name` },
        })
        .returning({ id: companies.id });
      companyId = row!.id;
      companyIds.set(token, companyId);
      res.companies++;
    }

    const descriptionMd = p.descriptionMd ?? "";
    const contentHash = sha256(`${title}\n${descriptionMd}`);

    const existing = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.source, source), eq(jobs.externalId, p.externalId)));
    const isNew = existing.length === 0;

    await db
      .insert(jobs)
      .values({
        companyId,
        source,
        externalId: p.externalId,
        title,
        descriptionMd,
        locationRaw: p.location ?? null,
        remoteType: p.remoteType ?? "unknown",
        applyUrl: p.applyUrl,
        contentHash,
        postedAt: p.postedAt ?? null,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .onConflictDoUpdate({
        target: [jobs.source, jobs.externalId],
        set: {
          title,
          descriptionMd,
          locationRaw: p.location ?? null,
          remoteType: p.remoteType ?? "unknown",
          applyUrl: p.applyUrl,
          contentHash,
          postedAt: p.postedAt ?? null,
          lastSeenAt: now,
          closedAt: null,
        },
      });

    if (isNew) res.inserted++;
    else res.updated++;
  }

  return res;
}
