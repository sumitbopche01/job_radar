import { sql } from "drizzle-orm";
import { REGION_PATTERNS, stripGeneric, strippedLocSql } from "./eligibility.js";
import {
  classifyUsAccess,
  usContractSql,
  usHoursSql,
  usIndiaOkLocSql,
  usPinnedSql,
  usStrictSql,
  type UsAccess,
} from "./usRemote.js";

export type Region =
  | "usa"
  | "usa_all"
  | "india"
  | "uae"
  | "europe"
  | "singapore"
  | "asia"
  | "remote"
  | "other";

/** User-facing region filter options (order = priority). US remote is the top
 *  target, so it leads; `usa_all` is the opt-in "include US-only" view. */
export const REGIONS: { slug: Region; label: string }[] = [
  { slug: "usa", label: "USA remote" },
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

/** US-access tier of a job (null = not a US role). Used for UI badges. */
export function usAccessOf(
  location: string | null | undefined,
  remoteType: string,
  description: string | null | undefined,
  title?: string | null,
): UsAccess | null {
  const loc = (location ?? "").toLowerCase();
  const generic = remoteType === "remote" && stripGeneric(loc) === "";
  return classifyUsAccess(loc, remoteType, (description ?? "").toLowerCase(), generic, title);
}

const genericRemoteSql = (a: string) => `(${a}.remote_type = 'remote' and ${strippedLocSql(a)} = '')`;

/** SQL: the realistic US view — India-allowed, contract-friendly, or a US-hours
 *  company hiring anywhere. Strict US-only roles are excluded. */
function usaSql(a: string): string {
  return (
    `(${a}.remote_type = 'remote' and (` +
    `(${usPinnedSql(a)} and (${usIndiaOkLocSql(a)} or (not ${usStrictSql(a)} and ${usContractSql(a)})))` +
    ` or (${genericRemoteSql(a)} and ${usHoursSql(a)} and not ${usStrictSql(a)})` +
    `))`
  );
}

/** SQL: everything US — adds the strict US-only roles (opt-in toggle). */
function usaAllSql(a: string): string {
  return (
    `(${a}.remote_type = 'remote' and (${usPinnedSql(a)}` +
    ` or (${genericRemoteSql(a)} and (${usHoursSql(a)} or ${usStrictSql(a)}))))`
  );
}

/**
 * SQL condition restricting to a region, keyed to a table alias. For "remote" it
 * means generic remote (strips to empty); for a geo region it means the location
 * matches that region's patterns; "usa"/"usa_all" use the US-access tiers.
 */
export function regionClause(region: Region, alias = "jobs") {
  const loc = `lower(coalesce(${alias}.location_raw, ''))`;
  if (region === "usa") return sql.raw(usaSql(alias));
  if (region === "usa_all") return sql.raw(usaAllSql(alias));
  if (region === "remote") return sql.raw(genericRemoteSql(alias));
  const patterns = REGION_PATTERNS[region] ?? [];
  if (patterns.length === 0) return sql.raw("true");
  return sql.raw("(" + patterns.map((p) => `${loc} like '%${p}%'`).join(" or ") + ")");
}

/** True for the US views, which bypass/override the default geo gate & ordering. */
export const isUsRegion = (r: Region | undefined): r is "usa" | "usa_all" =>
  r === "usa" || r === "usa_all";

/** SQL sort key for the US views: 0 India-allowed, 1 contract, 2 US-hours, 3 US-only. */
export function usTierSql(alias = "jobs") {
  return sql.raw(
    `(case` +
      ` when ${usPinnedSql(alias)} and ${usIndiaOkLocSql(alias)} then 0` +
      ` when ${usPinnedSql(alias)} and not ${usStrictSql(alias)} and ${usContractSql(alias)} then 1` +
      ` when ${genericRemoteSql(alias)} and ${usHoursSql(alias)} and not ${usStrictSql(alias)} then 2` +
      ` else 3 end)`,
  );
}
