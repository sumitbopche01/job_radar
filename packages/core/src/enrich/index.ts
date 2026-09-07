import PQueue from "p-queue";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies, jobEnrichment, jobs } from "../db/schema.js";
import { ensureSearchIndexes } from "../db/fts.js";
import { TITLE_BLOCKLIST } from "../filters/stage0.js";
import { eligibilityClause } from "../filters/eligibility.js";
import { roleTargetClause } from "../filters/roles.js";
import { embed, extractJob, MODELS, type Extraction } from "../llm/index.js";

export interface EnrichOptions {
  limit?: number;
  sinceDays?: number;
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface EnrichResult {
  enriched: number;
  failed: number;
}

interface PoolRow {
  id: string;
  title: string;
  companyName: string;
  descriptionMd: string;
}

/** Jobs past the stage-0 gate that don't yet have enrichment. Enrichment is lazy. */
async function jobsNeedingEnrichment(db: Db, sinceDays: number, limit: number): Promise<PoolRow[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const notBlocked = TITLE_BLOCKLIST.map(
    (t) => sql`lower(${jobs.title}) not like ${"%" + t.toLowerCase() + "%"}`,
  );
  return db
    .select({
      id: jobs.id,
      title: jobs.title,
      companyName: companies.name,
      descriptionMd: jobs.descriptionMd,
    })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(
      and(
        isNull(jobs.closedAt),
        isNull(jobs.canonicalJobId),
        or(gte(jobs.postedAt, since), and(isNull(jobs.postedAt), gte(jobs.firstSeenAt, since))),
        sql`not exists (select 1 from ${jobEnrichment} e where e.job_id = ${jobs.id})`,
        eligibilityClause("jobs"),
        roleTargetClause("jobs"),
        ...notBlocked,
      ),
    )
    .limit(limit);
}

export async function enrichJobs(db: Db, opts: EnrichOptions = {}): Promise<EnrichResult> {
  await ensureSearchIndexes(db);
  const limit = opts.limit ?? 200;
  const sinceDays = opts.sinceDays ?? 30;
  const concurrency = opts.concurrency ?? 5;

  const rows = await jobsNeedingEnrichment(db, sinceDays, limit);
  if (rows.length === 0) return { enriched: 0, failed: 0 };

  // 1) extract (LLM) with bounded concurrency
  const queue = new PQueue({ concurrency });
  const extracted: { row: PoolRow; ex: Extraction }[] = [];
  let failed = 0;
  let done = 0;
  await Promise.all(
    rows.map((row) =>
      queue.add(async () => {
        try {
          const ex = await extractJob({
            title: row.title,
            company: row.companyName,
            descriptionMd: row.descriptionMd,
          });
          extracted.push({ row, ex });
        } catch {
          failed++;
        } finally {
          opts.onProgress?.(++done, rows.length);
        }
      }),
    ),
  );
  if (extracted.length === 0) return { enriched: 0, failed };

  // 2) embed all distilled summaries in one batched call
  const vectors = await embed(extracted.map((e) => e.ex.summary));

  // 3) store
  for (let i = 0; i < extracted.length; i++) {
    const { row, ex } = extracted[i]!;
    const vec = vectors[i]!;
    await db
      .insert(jobEnrichment)
      .values({
        jobId: row.id,
        seniority: ex.seniority,
        stack: ex.stack,
        domainTags: ex.domainTags,
        timezoneRequirement: ex.timezoneRequirement,
        workAuthRequirement: ex.workAuthRequirement,
        compParsed: { min: ex.compMin, max: ex.compMax, currency: ex.compCurrency },
        summary: ex.summary,
        embedding: vec,
        model: `${MODELS.extract}+${MODELS.embed}`,
      })
      .onConflictDoUpdate({
        target: jobEnrichment.jobId,
        set: {
          seniority: ex.seniority,
          stack: ex.stack,
          domainTags: ex.domainTags,
          timezoneRequirement: ex.timezoneRequirement,
          workAuthRequirement: ex.workAuthRequirement,
          compParsed: { min: ex.compMin, max: ex.compMax, currency: ex.compCurrency },
          summary: ex.summary,
          embedding: vec,
          model: `${MODELS.extract}+${MODELS.embed}`,
          enrichedAt: new Date(),
        },
      });
  }

  return { enriched: extracted.length, failed };
}
