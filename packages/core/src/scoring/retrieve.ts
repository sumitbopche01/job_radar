import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { TITLE_BLOCKLIST, titleRegexExclusionSql } from "../filters/stage0.js";
import { eligibilityClause } from "../filters/eligibility.js";
import { roleTargetClause } from "../filters/roles.js";
import type { ProfileRow } from "../profiles/index.js";

export interface RetrievedJob {
  jobId: string;
  title: string;
  companyName: string;
  ftsRank: number | null;
  vecRank: number | null;
  rrf: number;
}

export interface RetrieveOptions {
  poolSize?: number; // how many from each retriever before fusion
  limit?: number; // final fused results
  sinceDays?: number;
}

const RRF_K = 60; // reciprocal-rank-fusion constant (design doc §7)

/** Keyword string for websearch_to_tsquery, OR-joined from the profile. */
export function profileKeywords(profile: ProfileRow): string {
  const terms = new Set<string>();
  for (const t of profile.label.split(/[-_]/)) if (t.length > 2) terms.add(t);
  const mh = (profile.mustHave ?? {}) as Record<string, unknown>;
  for (const key of ["stack_any", "keywords"]) {
    const arr = mh[key];
    if (Array.isArray(arr)) for (const v of arr) if (typeof v === "string") terms.add(v.toLowerCase());
  }
  return [...terms].join(" OR ");
}

/**
 * Stage-1 hybrid retrieval: Postgres FTS and pgvector run side by side and are
 * fused with reciprocal rank fusion. Vector half is skipped when the profile has
 * no embedding or nothing is enriched yet — FTS alone still works.
 */
export async function retrieve(
  db: Db,
  profile: ProfileRow,
  opts: RetrieveOptions = {},
): Promise<RetrievedJob[]> {
  const poolSize = opts.poolSize ?? 200;
  const limit = opts.limit ?? 60;
  const sinceDays = opts.sinceDays ?? 14;
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString();
  const notBlocked = TITLE_BLOCKLIST.map(
    (t) => sql`lower(j.title) not like ${"%" + t.toLowerCase() + "%"}`,
  );

  const pool = sql`
    j.closed_at is null
    and j.canonical_job_id is null
    and (j.posted_at >= ${since} or j.first_seen_at >= ${since})
    and ${eligibilityClause("j")}
    and ${roleTargetClause("j")}
    and ${titleRegexExclusionSql("j")}
    and ${sql.join(notBlocked, sql` and `)}
  `;

  // --- FTS ---
  const kw = profileKeywords(profile);
  const ftsRows = kw
    ? ((await db.execute(sql`
        select j.id as job_id, j.title, c.name as company_name,
               ts_rank_cd(j.search_tsv, q) as rank
        from jobs j
        join companies c on c.id = j.company_id,
             websearch_to_tsquery('english', ${kw}) q
        where ${pool} and j.search_tsv @@ q
        order by rank desc
        limit ${poolSize}
      `)) as unknown as { job_id: string; title: string; company_name: string; rank: number }[])
    : [];

  // --- Vector ---
  let vecRows: { job_id: string; title: string; company_name: string; dist: number }[] = [];
  if (profile.embedding && profile.embedding.length > 0) {
    const vecLiteral = `[${profile.embedding.join(",")}]`;
    vecRows = (await db.execute(sql`
      select j.id as job_id, j.title, c.name as company_name,
             (e.embedding <=> ${vecLiteral}::halfvec) as dist
      from job_enrichment e
      join jobs j on j.id = e.job_id
      join companies c on c.id = j.company_id
      where ${pool}
      order by dist asc
      limit ${poolSize}
    `)) as unknown as { job_id: string; title: string; company_name: string; dist: number }[];
  }

  // --- RRF fusion ---
  const acc = new Map<string, RetrievedJob>();
  ftsRows.forEach((r, i) => {
    acc.set(r.job_id, {
      jobId: r.job_id,
      title: r.title,
      companyName: r.company_name,
      ftsRank: i + 1,
      vecRank: null,
      rrf: 1 / (RRF_K + i + 1),
    });
  });
  vecRows.forEach((r, i) => {
    const prev = acc.get(r.job_id);
    if (prev) {
      prev.vecRank = i + 1;
      prev.rrf += 1 / (RRF_K + i + 1);
    } else {
      acc.set(r.job_id, {
        jobId: r.job_id,
        title: r.title,
        companyName: r.company_name,
        ftsRank: null,
        vecRank: i + 1,
        rrf: 1 / (RRF_K + i + 1),
      });
    }
  });

  return [...acc.values()].sort((a, b) => b.rrf - a.rrf).slice(0, limit);
}
