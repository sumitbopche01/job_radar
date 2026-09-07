import { eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { profiles } from "../db/schema.js";
import { embed } from "../llm/index.js";

export interface ProfileSeed {
  label: string;
  resumeMd: string;
  mustHave?: unknown;
  exclude?: unknown;
}

export interface ProfileRow {
  id: string;
  label: string;
  resumeMd: string;
  mustHave: unknown;
  exclude: unknown;
  embedding: number[] | null;
}

export async function seedProfiles(db: Db, seeds: ProfileSeed[]): Promise<number> {
  if (seeds.length === 0) return 0;
  await db
    .insert(profiles)
    .values(
      seeds.map((s) => ({
        label: s.label,
        resumeMd: s.resumeMd,
        mustHave: s.mustHave ?? null,
        exclude: s.exclude ?? null,
      })),
    )
    .onConflictDoUpdate({
      target: profiles.label,
      // resume text may change; keep the embedding until re-embedded
      set: { resumeMd: sql`excluded.resume_md`, mustHave: sql`excluded.must_have`, exclude: sql`excluded.exclude` },
    });
  return seeds.length;
}

/** Embed each profile's resume summary (design doc §7: embed the archetype summary). */
export async function embedProfiles(db: Db, force = false): Promise<number> {
  const rows = await db
    .select({ id: profiles.id, resumeMd: profiles.resumeMd, embedding: profiles.embedding })
    .from(profiles)
    .where(force ? undefined : isNull(profiles.embedding));
  if (rows.length === 0) return 0;
  const vecs = await embed(rows.map((r) => r.resumeMd));
  for (let i = 0; i < rows.length; i++) {
    await db.update(profiles).set({ embedding: vecs[i]! }).where(eq(profiles.id, rows[i]!.id));
  }
  return rows.length;
}

export async function getProfile(db: Db, label: string): Promise<ProfileRow | undefined> {
  const [row] = await db.select().from(profiles).where(eq(profiles.label, label));
  return row as ProfileRow | undefined;
}

export async function listProfiles(db: Db): Promise<ProfileRow[]> {
  return (await db.select().from(profiles)) as ProfileRow[];
}
