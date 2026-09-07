import { and, eq, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies } from "../db/schema.js";

export interface LivenessReport {
  total: number;
  active: number;
  stale: number;
  dead: number;
  neverCrawled: number;
  failingPct: number; // (stale + dead) / total * 100
  markedStale: number;
  markedDead: number;
}

const STALE_FAILURES = 5;
const STALE_DAYS = 14;
const DEAD_FAILURES = 15;
const DEAD_DAYS = 45;

/**
 * Liveness loop (design §3): boards churn. A token that keeps failing or has gone
 * silent drops active → stale (weekly polling) → dead. Crawl already increments
 * consecutive_failures and flips to stale at 7; this adds the time-based transitions
 * and the dead state, and reports the failing fraction (P3 target: < 2%).
 */
export async function runLiveness(db: Db): Promise<LivenessReport> {
  const nowStale = sql`now() - interval '${sql.raw(String(STALE_DAYS))} days'`;
  const nowDead = sql`now() - interval '${sql.raw(String(DEAD_DAYS))} days'`;

  const staleRes = await db
    .update(companies)
    .set({ status: "stale" })
    .where(
      and(
        eq(companies.status, "active"),
        or(
          sql`${companies.consecutiveFailures} >= ${STALE_FAILURES}`,
          and(sql`${companies.lastOkAt} is not null`, lt(companies.lastOkAt, nowStale as never)),
        ),
      ),
    )
    .returning({ id: companies.id });

  const deadRes = await db
    .update(companies)
    .set({ status: "dead" })
    .where(
      and(
        eq(companies.status, "stale"),
        or(
          sql`${companies.consecutiveFailures} >= ${DEAD_FAILURES}`,
          and(sql`${companies.lastOkAt} is not null`, lt(companies.lastOkAt, nowDead as never)),
        ),
      ),
    )
    .returning({ id: companies.id });

  const [c] = await db
    .select({
      total: sql<number>`count(*)::int`,
      active: sql<number>`count(*) filter (where status = 'active')::int`,
      stale: sql<number>`count(*) filter (where status = 'stale')::int`,
      dead: sql<number>`count(*) filter (where status = 'dead')::int`,
      never: sql<number>`count(*) filter (where last_ok_at is null)::int`,
    })
    .from(companies);

  const total = c?.total ?? 0;
  const failing = (c?.stale ?? 0) + (c?.dead ?? 0);
  return {
    total,
    active: c?.active ?? 0,
    stale: c?.stale ?? 0,
    dead: c?.dead ?? 0,
    neverCrawled: c?.never ?? 0,
    failingPct: total ? (failing / total) * 100 : 0,
    markedStale: staleRes.length,
    markedDead: deadRes.length,
  };
}
