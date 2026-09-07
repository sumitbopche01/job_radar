import PQueue from "p-queue";
import { and, eq, ne } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies } from "../db/schema.js";
import { adapters, getAdapter } from "../adapters/index.js";
import type { CrawlTarget } from "../types.js";
import { crawlCompany, type CrawlResult } from "./crawl.js";

export interface RunOptions {
  /** only crawl this ATS provider */
  only?: string;
  /** only crawl companies matching this board token (exact) */
  company?: string;
  /** include stale/dead companies too (default: active only) */
  includeInactive?: boolean;
  onResult?: (r: CrawlResult) => void;
}

export async function runCrawl(db: Db, opts: RunOptions = {}): Promise<CrawlResult[]> {
  const where = [];
  if (!opts.includeInactive) where.push(ne(companies.status, "dead"));
  if (opts.only) where.push(eq(companies.atsProvider, opts.only as never));
  if (opts.company) where.push(eq(companies.boardToken, opts.company));

  const rows = await db
    .select()
    .from(companies)
    .where(where.length ? and(...where) : undefined);

  const targets: CrawlTarget[] = rows
    .filter((c) => getAdapter(c.atsProvider))
    .map((c) => ({
      companyId: c.id,
      companyName: c.name,
      provider: c.atsProvider,
      boardToken: c.boardToken ?? "",
      workdayTenant: c.workdayTenant,
      workdaySite: c.workdaySite,
    }));

  // One queue per provider so each ATS honors its own rate limit.
  const queues = new Map<string, PQueue>();
  for (const [id, a] of Object.entries(adapters)) {
    queues.set(id, new PQueue({ concurrency: a.rateLimit.concurrency, interval: a.rateLimit.minDelayMs, intervalCap: 1 }));
  }

  const results: CrawlResult[] = [];
  await Promise.all(
    targets.map((t) => {
      const q = queues.get(t.provider);
      if (!q) return Promise.resolve();
      return q.add(async () => {
        const r = await crawlCompany(db, t);
        results.push(r);
        opts.onResult?.(r);
      });
    }),
  );

  return results;
}
