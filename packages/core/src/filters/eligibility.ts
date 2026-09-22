import { sql } from "drizzle-orm";

/**
 * Geo-eligibility, modeled as data (design doc §14.3). Tuned to a candidate based
 * in India who is open to:
 *   - India onsite (Bengaluru etc.)
 *   - remote doable from India (generic/global remote, APAC/Asia)
 *   - Dubai / UAE onsite (visa sponsored)
 *   - Singapore onsite
 *   - Europe onsite + remote (relocation / visa sponsorship OK) — priority region
 *
 * Single source of truth for "where can I work". Coarse, high-recall — the LLM
 * judge still reports fine-grained `eligibility_risk` (timezone / work_auth).
 *
 * Rule (allowlist): a job is eligible if
 *   (a) its location names an eligible geo (any REGION_PATTERNS below), OR
 *   (b) it's remote AND its location is *generic* (strips to nothing once the
 *       remote/global boilerplate is removed).
 */

/** Eligible geos grouped by region — also powers the region filter (region.ts). */
export const REGION_PATTERNS: Record<string, string[]> = {
  india: [
    "india",
    "bengaluru",
    "bangalore",
    "gurugram",
    "gurgaon",
    "hyderabad",
    "mumbai",
    "new delhi",
    "delhi",
    "noida",
    "pune",
    "chennai",
    "kolkata",
  ],
  uae: ["dubai", "abu dhabi", "uae", "u.a.e", "united arab emirates"],
  singapore: ["singapore"],
  europe: [
    "europe",
    "emea",
    "european union",
    "united kingdom",
    "england",
    "scotland",
    "ireland",
    "germany",
    "netherlands",
    "france",
    "spain",
    "portugal",
    "poland",
    "sweden",
    "denmark",
    "finland",
    "norway",
    "switzerland",
    "austria",
    "italy",
    "belgium",
    "czech",
    "czechia",
    "romania",
    "estonia",
    "lithuania",
    "latvia",
    "greece",
    "hungary",
    "bulgaria",
    "croatia",
    "luxembourg",
    // distinctive hubs (bare-city listings)
    "london",
    "berlin",
    "munich",
    "hamburg",
    "frankfurt",
    "amsterdam",
    "paris",
    "madrid",
    "barcelona",
    "dublin",
    "lisbon",
    "warsaw",
    "krakow",
    "stockholm",
    "copenhagen",
    "zurich",
    "geneva",
    "vienna",
    "milan",
    "brussels",
    "helsinki",
    "prague",
    "tallinn",
    "vilnius",
    "budapest",
  ],
  asia: ["asia", "apac"],
};

/** Flattened eligible-location patterns. */
export const ELIGIBLE_LOCATION_PATTERNS = Object.values(REGION_PATTERNS).flat();

/** Boilerplate stripped from a location to decide whether a remote role is "generic". */
export const GENERIC_REMOTE_WORDS = [
  "remote",
  "global",
  "globally",
  "worldwide",
  "anywhere",
  "hybrid",
  "distributed",
  "work from home",
  "wfh",
  "flexible",
  "fully",
];
const GENERIC_RE = new RegExp(`(${GENERIC_REMOTE_WORDS.join("|")})`, "g");

export function stripGeneric(loc: string): string {
  return loc
    .replace(GENERIC_RE, " ")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/** SQL fragment: the location stripped of remote/generic words (empty = generic remote). */
export function strippedLocSql(alias = "jobs"): string {
  const loc = `lower(coalesce(${alias}.location_raw, ''))`;
  return `btrim(regexp_replace(regexp_replace(${loc}, '(${GENERIC_REMOTE_WORDS.join(
    "|",
  )})', ' ', 'g'), '[^a-z]+', ' ', 'g'))`;
}

/** JS predicate mirroring the SQL clause. */
export function isEligible(location: string | null | undefined, remoteType: string): boolean {
  const loc = (location ?? "").toLowerCase();
  if (ELIGIBLE_LOCATION_PATTERNS.some((p) => loc.includes(p))) return true;
  if (remoteType === "remote" && stripGeneric(loc) === "") return true;
  return false;
}

/** SQL eligibility condition, keyed to a table alias (default "jobs"; retrieve uses "j"). */
export function eligibilityClause(alias = "jobs") {
  const loc = `lower(coalesce(${alias}.location_raw, ''))`;
  const eligibleLike =
    "(" + ELIGIBLE_LOCATION_PATTERNS.map((p) => `${loc} like '%${p}%'`).join(" or ") + ")";
  return sql.raw(
    `(${eligibleLike} or (${alias}.remote_type = 'remote' and ${strippedLocSql(alias)} = ''))`,
  );
}
