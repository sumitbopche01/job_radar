import { sql } from "drizzle-orm";
import { hasContractSignal, hasUsStrict, isUsPinned, usContractEligibleSql } from "./usRemote.js";

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
 *       remote/global boilerplate is removed), OR
 *   (c) it's US-pinned remote whose description signals contractors / global
 *       hiring with no strict US-only requirement (usRemote.ts) — the candidate
 *       can engage as a B2B contractor through his firm.
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

/** Filler/connector words left behind after generic stripping (e.g. "anywhere in
 *  the world" -> "in the world"). Dropped as whole words so a bare global-remote
 *  location strips to empty and counts as eligible. */
export const LOCATION_STOPWORDS = [
  "the", "in", "of", "on", "any", "a", "an", "and", "or", "to", "for",
  "from", "only", "location", "based", "within", "across", "world", "earth",
];
const STOP_RE = new RegExp(`\\b(${LOCATION_STOPWORDS.join("|")})\\b`, "g");

export function stripGeneric(loc: string): string {
  return loc
    .replace(GENERIC_RE, " ")
    .replace(/[^a-z]+/g, " ")
    .replace(STOP_RE, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** SQL fragment: the location stripped of remote/generic + filler words (empty = generic remote). */
export function strippedLocSql(alias = "jobs"): string {
  const loc = `lower(coalesce(${alias}.location_raw, ''))`;
  const noGeneric = `regexp_replace(${loc}, '(${GENERIC_REMOTE_WORDS.join("|")})', ' ', 'g')`;
  const letters = `regexp_replace(${noGeneric}, '[^a-z]+', ' ', 'g')`;
  const noStop = `regexp_replace(${letters}, '\\y(${LOCATION_STOPWORDS.join("|")})\\y', ' ', 'g')`;
  return `btrim(regexp_replace(${noStop}, '\\s+', ' ', 'g'))`;
}

/** JS predicate mirroring the SQL clause. Pass `description` to evaluate the
 *  US-contract door (without it, US-pinned roles are treated as ineligible). */
export function isEligible(
  location: string | null | undefined,
  remoteType: string,
  description?: string | null,
  title?: string | null,
): boolean {
  const loc = (location ?? "").toLowerCase();
  if (ELIGIBLE_LOCATION_PATTERNS.some((p) => loc.includes(p))) return true;
  if (remoteType === "remote" && stripGeneric(loc) === "") return true;
  // (c) US-remote that signals contractors / global hiring and has no strict
  //     US-only requirement — engageable via a B2B contract (see usRemote.ts)
  if (
    remoteType === "remote" &&
    description != null &&
    isUsPinned(loc) &&
    !hasUsStrict(description.toLowerCase()) &&
    hasContractSignal(description.toLowerCase(), title)
  ) {
    return true;
  }
  return false;
}

/** SQL eligibility condition, keyed to a table alias (default "jobs"; retrieve uses "j"). */
export function eligibilityClause(alias = "jobs") {
  const loc = `lower(coalesce(${alias}.location_raw, ''))`;
  const eligibleLike =
    "(" + ELIGIBLE_LOCATION_PATTERNS.map((p) => `${loc} like '%${p}%'`).join(" or ") + ")";
  return sql.raw(
    `(${eligibleLike} or (${alias}.remote_type = 'remote' and ${strippedLocSql(alias)} = '') or ${usContractEligibleSql(alias)})`,
  );
}
