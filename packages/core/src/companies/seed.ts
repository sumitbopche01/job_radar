import { sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { companies } from "../db/schema.js";
import type { AtsProvider } from "../types.js";

export interface SeedCompany {
  name: string;
  provider: AtsProvider;
  token: string;
  domain?: string;
  tier?: "hot" | "normal" | "long_tail";
}

export interface SeedResult {
  inserted: number;
  total: number;
}

/** Idempotent upsert of seed companies keyed by (ats_provider, board_token). */
export async function seedCompanies(db: Db, seeds: SeedCompany[]): Promise<SeedResult> {
  if (seeds.length === 0) return { inserted: 0, total: 0 };

  const before = await countCompanies(db);
  await db
    .insert(companies)
    .values(
      seeds.map((s) => ({
        name: s.name,
        atsProvider: s.provider,
        boardToken: s.token,
        domain: s.domain ?? null,
        tier: s.tier ?? ("normal" as const),
        discoveredVia: "seed",
      })),
    )
    .onConflictDoUpdate({
      target: [companies.atsProvider, companies.boardToken],
      set: { name: sql`excluded.name` },
    });
  const after = await countCompanies(db);
  return { inserted: after - before, total: after };
}

async function countCompanies(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(companies);
  return row?.n ?? 0;
}
