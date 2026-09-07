import { sql } from "drizzle-orm";
import type { Db } from "./client.js";

/**
 * Idempotent search-index bootstrap. These are DB-only objects Drizzle's schema
 * layer can't express (a generated tsvector column, a GIN index, and an HNSW
 * vector index), so they live here and are ensured before any retrieval/scoring
 * run rather than in a tracked migration.
 */
export async function ensureSearchIndexes(db: Db): Promise<void> {
  // Full-text: a stored generated tsvector over title + description.
  await db.execute(sql`
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
      to_tsvector('english', coalesce(title, '') || ' ' || coalesce(description_md, ''))
    ) STORED
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS jobs_search_tsv_idx ON jobs USING gin (search_tsv)`);

  // Vector: HNSW over the halfvec embedding, cosine distance.
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS job_enrichment_embedding_idx
    ON job_enrichment USING hnsw (embedding halfvec_cosine_ops)
  `);
}
