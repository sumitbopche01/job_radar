import { sql } from "drizzle-orm";

/**
 * Geo-eligibility, modeled as data (design doc §14.3). Tuned to a candidate based
 * in India who can take:
 *   - Bengaluru / India onsite
 *   - remote roles doable from India (generic/global remote, or APAC/Asia)
 *   - Dubai / UAE onsite (employer sponsors visa)
 *   - Singapore onsite
 *   - international contract (has an entity for foreign payments)
 *
 * This is the single place to adjust "where can I work". It's a coarse, high-recall
 * gate — the LLM judge still reports fine-grained `eligibility_risk` (timezone /
 * work_auth) on what passes.
 *
 * Rule (allowlist, not blocklist): a job is eligible if
 *   (a) its location names an eligible geo, OR
 *   (b) it's remote AND its location is *generic* (strips to nothing once the
 *       remote/global boilerplate is removed) — e.g. "Remote", "Remote - Global".
 * A remote role tied to a specific non-eligible place ("Remote - US", "San
 * Francisco", "London") is excluded because its stripped location is non-empty and
 * doesn't match an eligible geo.
 */

/** Locations that are eligible whether onsite or remote. */
export const ELIGIBLE_LOCATION_PATTERNS = [
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
  "dubai",
  "abu dhabi",
  "uae",
  "u.a.e",
  "united arab emirates",
  "singapore",
  "asia",
  "apac",
];

/** Boilerplate stripped from a location to decide whether a remote role is "generic". */
const GENERIC_REMOTE_WORDS = [
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

function stripGeneric(loc: string): string {
  return loc
    .replace(GENERIC_RE, " ")
    .replace(/[^a-z]+/g, " ")
    .trim();
}

/** JS predicate mirroring the SQL clause — used in tests and any in-memory filtering. */
export function isEligible(location: string | null | undefined, remoteType: string): boolean {
  const loc = (location ?? "").toLowerCase();
  if (ELIGIBLE_LOCATION_PATTERNS.some((p) => loc.includes(p))) return true;
  if (remoteType === "remote" && stripGeneric(loc) === "") return true;
  return false;
}

/**
 * SQL condition equivalent, keyed to a table alias (default "jobs"; retrieve uses "j").
 * Patterns are trusted code constants (no user input), inlined as literals.
 */
export function eligibilityClause(alias = "jobs") {
  const loc = `lower(coalesce(${alias}.location_raw, ''))`;
  const eligibleLike =
    "(" + ELIGIBLE_LOCATION_PATTERNS.map((p) => `${loc} like '%${p}%'`).join(" or ") + ")";
  // strip remote/global boilerplate and all non-letters; generic remote => empty
  const stripped = `btrim(regexp_replace(regexp_replace(${loc}, '(${GENERIC_REMOTE_WORDS.join(
    "|",
  )})', ' ', 'g'), '[^a-z]+', ' ', 'g'))`;
  return sql.raw(`(${eligibleLike} or (${alias}.remote_type = 'remote' and ${stripped} = ''))`);
}
