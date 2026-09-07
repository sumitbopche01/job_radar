import PQueue from "p-queue";
import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies } from "../db/schema.js";
import { detectAts, probeAts, type DetectResult } from "./detect.js";
import type { AtsProvider } from "../types.js";

export interface DiscoverEntry {
  name?: string;
  domain: string;
}

export interface DiscoverOptions {
  concurrency?: number;
  tier?: "hot" | "normal" | "long_tail";
  discoveredVia?: string;
  onResult?: (r: DetectResult & { name?: string }) => void;
}

export interface DiscoverResult {
  processed: number;
  resolved: number; // regex-detected + verified
  added: number; // net new companies in the registry
  misses: number; // regex miss -> candidates for the resolution agent
  missDomains: string[];
}

async function countCompanies(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(companies);
  return row?.n ?? 0;
}

export interface TokenEntry {
  provider: AtsProvider;
  token: string;
  name?: string;
}

export interface TokenImportResult {
  processed: number;
  verified: number;
  added: number;
  dead: string[];
}

/**
 * Seed source (design §3): import a list of ATS tokens directly (from public
 * GitHub token lists, fund portfolios, etc.). Each token is VERIFIED by probing
 * its endpoint before it enters the registry — dead tokens are dropped.
 */
export async function discoverTokens(
  db: Db,
  entries: TokenEntry[],
  opts: { concurrency?: number; onResult?: (e: TokenEntry, jobs: number) => void } = {},
): Promise<TokenImportResult> {
  const queue = new PQueue({ concurrency: opts.concurrency ?? 10 });
  const before = await countCompanies(db);
  let verified = 0;
  const dead: string[] = [];

  await Promise.all(
    entries.map((e) =>
      queue.add(async () => {
        const n = await probeAts(e.provider, e.token);
        opts.onResult?.(e, n);
        if (n > 0) {
          verified++;
          await upsertDiscovered(db, {
            name: e.name,
            domain: "",
            provider: e.provider,
            token: e.token,
            via: "token-list",
          });
        } else {
          dead.push(`${e.provider}/${e.token}`);
        }
      }),
    ),
  );

  const after = await countCompanies(db);
  return { processed: entries.length, verified, added: after - before, dead };
}

/** Upsert one detected/resolved board into the registry (deduped by provider+token). */
export async function upsertDiscovered(
  db: Db,
  r: { name?: string; domain: string; provider: string; token: string; via?: string; tier?: "hot" | "normal" | "long_tail" },
): Promise<void> {
  const domain = r.domain?.trim() || null;
  const insert = db.insert(companies).values({
    name: r.name?.trim() || r.token,
    domain,
    atsProvider: r.provider as never,
    boardToken: r.token,
    tier: r.tier ?? "normal",
    discoveredVia: r.via ?? "detect",
  });
  // refresh the domain on conflict only when we actually have one; else no-op
  await (domain
    ? insert.onConflictDoUpdate({ target: [companies.atsProvider, companies.boardToken], set: { domain } })
    : insert.onConflictDoNothing({ target: [companies.atsProvider, companies.boardToken] }));
}

/**
 * Run ATS detection over a list of domains and upsert the verified boards into the
 * registry. Dedupes by (ats_provider, board_token) so re-runs and overlapping seed
 * lists are idempotent. Regex misses are returned for the resolution agent.
 */
export async function discoverCompanies(
  db: Db,
  entries: DiscoverEntry[],
  opts: DiscoverOptions = {},
): Promise<DiscoverResult> {
  const concurrency = opts.concurrency ?? 8;
  const before = await countCompanies(db);
  const queue = new PQueue({ concurrency });

  let resolved = 0;
  const missDomains: string[] = [];

  await Promise.all(
    entries.map((e) =>
      queue.add(async () => {
        const res = await detectAts(e.domain, e.name);
        opts.onResult?.({ ...res, name: e.name });
        if (res.provider && res.token) {
          resolved++;
          await db
            .insert(companies)
            .values({
              name: e.name?.trim() || res.token,
              domain: res.domain,
              atsProvider: res.provider,
              boardToken: res.token,
              tier: opts.tier ?? "normal",
              discoveredVia: opts.discoveredVia ?? "detect",
            })
            .onConflictDoUpdate({
              target: [companies.atsProvider, companies.boardToken],
              set: { domain: res.domain },
            });
        } else {
          missDomains.push(res.domain);
        }
      }),
    ),
  );

  const after = await countCompanies(db);
  return {
    processed: entries.length,
    resolved,
    added: after - before,
    misses: missDomains.length,
    missDomains,
  };
}
