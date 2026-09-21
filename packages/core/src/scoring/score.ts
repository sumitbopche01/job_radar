import PQueue from "p-queue";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { jobEnrichment, jobScores } from "../db/schema.js";
import { ensureSearchIndexes } from "../db/fts.js";
import { getProfile } from "../profiles/index.js";
import { judgeJob, MODELS, type JudgeExample, type Rubric } from "../llm/index.js";
import { retrieve } from "./retrieve.js";

export interface ScoreOptions {
  limit?: number; // stage-1 survivors to judge
  top?: number; // escalate this many to the stronger model
  concurrency?: number;
  sinceDays?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface ScoreResult {
  retrieved: number;
  judged: number;
  escalated: number;
  skippedUnenriched: number;
  failed: number;
}

/** Up to k labeled examples nearest to this candidate by embedding (calibration). */
async function nearestLabeledExamples(db: Db, jobId: string, k: number): Promise<JudgeExample[]> {
  const rows = (await db.execute(sql`
    select je.summary, f.label, f.reason
    from feedback f
    join job_enrichment je on je.job_id = f.job_id
    join job_enrichment jc on jc.job_id = ${jobId}
    where je.embedding is not null and jc.embedding is not null and je.summary is not null
    order by je.embedding <=> jc.embedding
    limit ${k}
  `)) as unknown as { summary: string; label: "up" | "down"; reason: string | null }[];
  return rows.map((r) => ({ summary: r.summary, label: r.label, reason: r.reason }));
}

async function upsertScore(
  db: Db,
  jobId: string,
  profileId: string,
  stage: "s1" | "s2",
  score: number,
  rubric: unknown,
  model: string,
): Promise<void> {
  await db
    .insert(jobScores)
    .values({ jobId, profileId, stage, score, rubric: rubric as object, model })
    .onConflictDoUpdate({
      target: [jobScores.jobId, jobScores.profileId, jobScores.stage],
      set: { score, rubric: rubric as object, model, createdAt: new Date() },
    });
}

/**
 * Stage 1 (hybrid retrieval) -> stage 2 (LLM judge). Judges the stage-1 survivors
 * with the cheap model, then re-judges the top `top` with the stronger model.
 */
export async function scoreProfile(
  db: Db,
  profileLabel: string,
  opts: ScoreOptions = {},
): Promise<ScoreResult> {
  const profile = await getProfile(db, profileLabel);
  if (!profile) throw new Error(`no profile "${profileLabel}" — run: jr profiles seed`);

  await ensureSearchIndexes(db);
  const limit = opts.limit ?? 60;
  const top = opts.top ?? 15;
  const concurrency = opts.concurrency ?? 5;

  const retrieved = await retrieve(db, profile, { limit, sinceDays: opts.sinceDays });
  if (retrieved.length === 0)
    return { retrieved: 0, judged: 0, escalated: 0, skippedUnenriched: 0, failed: 0 };

  // load distilled summaries for the survivors
  const ids = retrieved.map((r) => r.jobId);
  const enr = await db
    .select({ jobId: jobEnrichment.jobId, summary: jobEnrichment.summary })
    .from(jobEnrichment)
    .where(inArray(jobEnrichment.jobId, ids));
  const summaryMap = new Map(enr.filter((e) => e.summary).map((e) => [e.jobId, e.summary!]));

  const candidates = retrieved.filter((r) => summaryMap.has(r.jobId));
  const skippedUnenriched = retrieved.length - candidates.length;

  // stage-1 scores (RRF), stored for transparency
  for (const r of candidates) {
    await upsertScore(db, r.jobId, profile.id, "s1", Math.round(r.rrf * 100000), {
      ftsRank: r.ftsRank,
      vecRank: r.vecRank,
    }, "rrf");
  }

  // stage-2 first pass (cheap model)
  const queue = new PQueue({ concurrency });
  const judged: { jobId: string; title: string; company: string; fit: number }[] = [];
  let done = 0;
  let failed = 0;
  await Promise.all(
    candidates.map((r) =>
      queue.add(async () => {
        try {
          const fewShot = await nearestLabeledExamples(db, r.jobId, 8);
          const rubric = await judgeJob({
            profileLabel: profile.label,
            profileSummary: profile.resumeMd,
            mustHave: profile.mustHave,
            exclude: profile.exclude,
            fewShot,
            jobSummary: summaryMap.get(r.jobId)!,
            jobTitle: r.title,
            jobCompany: r.companyName,
            escalate: false,
          });
          await upsertScore(db, r.jobId, profile.id, "s2", rubric.fit_score, rubric, MODELS.judge);
          judged.push({ jobId: r.jobId, title: r.title, company: r.companyName, fit: rubric.fit_score });
        } catch {
          failed++; // surfaced in the result — no longer silently swallowed
        } finally {
          opts.onProgress?.(++done, candidates.length);
        }
      }),
    ),
  );

  // escalate the top `top` to the stronger model
  const top15 = [...judged].sort((a, b) => b.fit - a.fit).slice(0, top);
  let escalated = 0;
  for (const r of top15) {
    try {
      const fewShot = await nearestLabeledExamples(db, r.jobId, 8);
      const rubric: Rubric = await judgeJob({
        profileLabel: profile.label,
        profileSummary: profile.resumeMd,
        mustHave: profile.mustHave,
        exclude: profile.exclude,
        fewShot,
        jobSummary: summaryMap.get(r.jobId)!,
        jobTitle: r.title,
        jobCompany: r.company,
        escalate: true,
      });
      await upsertScore(db, r.jobId, profile.id, "s2", rubric.fit_score, rubric, MODELS.judgeTop);
      escalated++;
    } catch {
      /* keep the first-pass score */
    }
  }

  return { retrieved: retrieved.length, judged: judged.length, escalated, skippedUnenriched, failed };
}
