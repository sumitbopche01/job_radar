import { sql } from "drizzle-orm";
import { REGION_PATTERNS, stripGeneric, strippedLocSql } from "./eligibility.js";

export type Region = "india" | "uae" | "europe" | "singapore" | "asia" | "remote" | "other";

/** User-facing region filter options (order = priority: home, then priority regions). */
export const REGIONS: { slug: Region; label: string }[] = [
  { slug: "india", label: "India" },
  { slug: "europe", label: "Europe" },
  { slug: "uae", label: "Dubai / UAE" },
  { slug: "singapore", label: "Singapore" },
  { slug: "remote", label: "Remote" },
];

// order in which a location is tested (a job can match several; first wins)
const ORDER: Region[] = ["india", "uae", "singapore", "europe", "asia"];

/** Classify a job's location into a region. */
export function classifyRegion(location: string | null | undefined, remoteType: string): Region {
  const loc = (location ?? "").toLowerCase();
  for (const r of ORDER) {
    if (REGION_PATTERNS[r]!.some((p) => loc.includes(p))) return r;
  }
  if (remoteType === "remote" && stripGeneric(loc) === "") return "remote";
  return "other";
}

/**
 * SQL condition restricting to a region, keyed to a table alias. For "remote" it
 * means generic remote (strips to empty); for a geo region it means the location
 * matches that region's patterns.
 */
export function regionClause(region: Region, alias = "jobs") {
  const loc = `lower(coalesce(${alias}.location_raw, ''))`;
  if (region === "remote") {
    return sql.raw(`(${alias}.remote_type = 'remote' and ${strippedLocSql(alias)} = '')`);
  }
  const patterns = REGION_PATTERNS[region] ?? [];
  if (patterns.length === 0) return sql.raw("true");
  return sql.raw("(" + patterns.map((p) => `${loc} like '%${p}%'`).join(" or ") + ")");
}
