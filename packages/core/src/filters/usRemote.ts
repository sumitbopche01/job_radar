import { sql } from "drizzle-orm";

/**
 * US-remote access, for an India-based candidate who can engage as a B2B
 * contractor through his own firm (HariNext). "Remote – US" covers several very
 * different situations, so we split it into tiers rather than allow/deny:
 *
 *   india_ok  US-pinned role whose allowed locations ALSO list India / APAC / Asia
 *   contract  US-pinned role whose description signals contractors / global hiring
 *             (independent contractor, B2B, Deel/EOR, "work from anywhere"…) and
 *             carries NO strict US-only signal
 *   us_hours  generic-remote role that asks for US-timezone overlap (a US company
 *             hiring anywhere) — already geo-eligible, just labelled
 *   us_only   needs US work authorization / residency / clearance / W-2 — not
 *             realistic from India even as a contractor
 *
 * Strict signals always win over contract signals. Patterns are written once as
 * regex *bodies* that work in both Postgres (ARE) and JS; only the word-boundary
 * token differs (\y vs \b), so SQL gate and UI badge can't drift apart.
 */

// ---- location: is the role pinned to the US? ----
const US_LOC_WORDS = [
  "us",
  "usa",
  "united states",
  "america",
  "americas",
  "north america",
  "san francisco",
  "bay area",
  "silicon valley",
  "new york",
  "nyc",
  "seattle",
  "austin",
  "boston",
  "chicago",
  "los angeles",
  "denver",
  "atlanta",
  "miami",
  "washington dc",
];
// "City, ST" state codes. Deliberately omits in/de/id/me — those are also ISO
// country codes ("Bengaluru, IN", "Berlin, DE") and would misfire.
const US_STATE_CODES =
  "al|ak|az|ar|ca|co|ct|fl|ga|hi|il|ia|ks|ky|la|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy|dc";

// US territories that appear inside APAC/LATAM country lists (Himalayas' APAC set
// includes "United States Minor Outlying Islands", "Guam", "American Samoa"). They
// say nothing about a mainland-US role, so they're stripped before the US-pin test.
const US_TERRITORY_BODIES = [
  "united states minor outlying islands",
  "(us|u\\.s\\.?) virgin islands",
  "virgin islands",
  "american samoa",
  "guam",
  "northern mariana islands",
  "puerto rico",
];

// ---- location: does it ALSO allow India / APAC? ----
const INDIA_OK_LOC_WORDS = ["india", "apac", "asia", "asia pacific"];

// ---- description: hard US-only requirements (always win) ----
const STRICT_BODIES = [
  "authorized to work (in|for) (the )?(us|u\\.s\\.?|united states)",
  "(us|u\\.s\\.?) work authori[sz]ation",
  "legally (authorized|eligible) to work in (the )?(us|u\\.s\\.?|united states)",
  "(us|u\\.s\\.?) citizens?(hip)? (is )?(required|only)",
  "must be an? (us|u\\.s\\.?) citizen",
  "green card",
  "(security|active|secret|ts/sci) clearance",
  "itar",
  "(us|u\\.s\\.?) persons?",
  "must (reside|live|be located|be based) (with)?in (the )?(us|u\\.s\\.?|united states|contiguous)",
  "(remote|located|based|reside|residing) (with)?in the (us|u\\.s\\.?|united states|contiguous)",
  "(us|u\\.s\\.?)[- ]based (candidates |applicants )?only",
  "w-?2 (employee|position|role)",
  "1099",
  // no apostrophes anywhere in these bodies — they are inlined into SQL string literals
  "(will not|unable to|cannot|do not|does not) (provide |offer )?(visa )?sponsor",
  "(federal|government|defense|dod) contractor",
  "us citizen or us visa holder only",
];

// ---- description: contractor / hire-anywhere signals ----
// Must describe THIS role's hiring arrangement. Audited against the live queue:
// bare "contractor(s)", "b2b", "globally distributed" and plain "independent
// contractor" are dominated by boilerplate/product copy (e.g. Reddit's privacy
// notice: "…application for employment or an independent contractor role"), so
// they are deliberately NOT here.
const CONTRACT_BODIES = [
  "(this is|is) an? (full[- ]time |part[- ]time |long[- ]term |remote )?(contract|contractor|freelance) (role|position|engagement|opportunity)",
  "(as|is) an independent contractor",
  "independent contractor (position|basis|agreement|engagement)",
  "on a (contract|contractor|freelance|b2b) basis",
  "b2b (contract|basis|engagement|agreement)",
  "contract[- ]to[- ]hire",
  "[0-9]+[- ](month|week)s? contract",
  "deel",
  "remote\\.com",
  "oyster ?hr",
  "employer of record",
  "eor",
  "hire (globally|anywhere|worldwide|internationally)",
  "hiring (globally|worldwide|internationally|from anywhere)",
  "open to (candidates|applicants|contractors|talent) (worldwide|globally|from anywhere|internationally)",
  "international (candidates|applicants|contractors) (are )?welcome",
  "(from|in) any country",
  "work from anywhere in the world",
  "open to international candidates",
  // structured header lines written by the remote-board fetchers (remoteBoards.ts)
  "employment type: (contract|contractor|freelance|contract to hire)",
];

// ---- title: the strongest contract signal ("… (Remote Contract, USD 22/hr)") ----
const CONTRACT_TITLE_BODIES = ["contract", "contractor", "freelance", "freelancer"];

// ---- description: US-timezone overlap (a US company hiring remotely) ----
const US_HOURS_BODIES = [
  "(eastern|pacific|central|mountain) (standard |daylight )?time",
  "(pst|pdt|edt)",
  "[0-9] ?(am|pm) ?(est|et|pst|pt|edt|pdt|cst|ct)",
  "us (time ?zones?|hours|business hours|working hours)",
  "overlap with (the )?(us|u\\.s\\.?|north america|american)",
  "(north )?american (time ?zones?|hours|business hours)",
];

const jsRe = (bodies: string[]) => new RegExp(`\\b(${bodies.join("|")})\\b`, "i");
const pgRe = (bodies: string[]) => `\\y(${bodies.join("|")})\\y`;

const US_LOC_RE = jsRe(US_LOC_WORDS);
const US_STATE_RE = new RegExp(`,\\s*(${US_STATE_CODES})\\b`, "i");
const INDIA_OK_RE = jsRe(INDIA_OK_LOC_WORDS);
const STRICT_RE = jsRe(STRICT_BODIES);
const CONTRACT_RE = jsRe(CONTRACT_BODIES);
const CONTRACT_TITLE_RE = jsRe(CONTRACT_TITLE_BODIES);
const US_HOURS_RE = jsRe(US_HOURS_BODIES);

export type UsAccess = "india_ok" | "contract" | "us_hours" | "us_only";

const US_TERRITORY_RE = new RegExp(`\\b(${US_TERRITORY_BODIES.join("|")})\\b`, "gi");

export const isUsPinned = (loc: string | null | undefined) => {
  const l = (loc ?? "").toLowerCase().replace(US_TERRITORY_RE, " ");
  return US_LOC_RE.test(l) || US_STATE_RE.test(l);
};
export const hasUsStrict = (desc: string | null | undefined) => STRICT_RE.test(desc ?? "");
/** Contract / hire-anywhere signal from the description OR the title. */
export const hasContractSignal = (desc: string | null | undefined, title?: string | null) =>
  CONTRACT_RE.test(desc ?? "") || CONTRACT_TITLE_RE.test(title ?? "");
export const hasUsHours = (desc: string | null | undefined) => US_HOURS_RE.test(desc ?? "");

/**
 * Tier a job for the US view / badges. `genericRemote` = remote with a location
 * that strips to nothing (computed by the caller via eligibility's stripGeneric,
 * passed in to avoid an import cycle). Returns null for non-US roles.
 */
export function classifyUsAccess(
  loc: string | null | undefined,
  remoteType: string,
  desc: string | null | undefined,
  genericRemote: boolean,
  title?: string | null,
): UsAccess | null {
  if (remoteType === "remote" && isUsPinned(loc)) {
    if (INDIA_OK_RE.test(loc ?? "")) return "india_ok";
    if (hasUsStrict(desc)) return "us_only";
    if (hasContractSignal(desc, title)) return "contract";
    return "us_only"; // "Remote – US" with no signal either way: realistically US-only
  }
  if (genericRemote) {
    if (hasUsStrict(desc)) return "us_only"; // "Remote" location, but JD demands US auth
    if (hasUsHours(desc)) return "us_hours";
  }
  return null;
}

// ---- SQL fragments (alias-keyed; all on lower()'d columns) ----
const locSql = (a: string) => `lower(coalesce(${a}.location_raw, ''))`;
const descSql = (a: string) => `lower(coalesce(${a}.description_md, ''))`;

/** Location with US territories blanked out (mirrors isUsPinned's JS replace). */
const mainlandLocSql = (a: string) => `regexp_replace(${locSql(a)}, '${pgRe(US_TERRITORY_BODIES)}', ' ', 'g')`;
export const usPinnedSql = (a = "jobs") =>
  `(${mainlandLocSql(a)} ~ '${pgRe(US_LOC_WORDS)}' or ${mainlandLocSql(a)} ~ ',\\s*(${US_STATE_CODES})\\y')`;
export const usIndiaOkLocSql = (a = "jobs") => `(${locSql(a)} ~ '${pgRe(INDIA_OK_LOC_WORDS)}')`;
export const usStrictSql = (a = "jobs") => `(${descSql(a)} ~ '${pgRe(STRICT_BODIES)}')`;
export const usContractSql = (a = "jobs") =>
  `(${descSql(a)} ~ '${pgRe(CONTRACT_BODIES)}' or lower(coalesce(${a}.title, '')) ~ '${pgRe(CONTRACT_TITLE_BODIES)}')`;
export const usHoursSql = (a = "jobs") => `(${descSql(a)} ~ '${pgRe(US_HOURS_BODIES)}')`;

/** The one new door in the geo gate: remote + US-pinned + contract signal + no strict signal. */
export function usContractEligibleSql(a = "jobs") {
  return `(${a}.remote_type = 'remote' and ${usPinnedSql(a)} and not ${usStrictSql(a)} and ${usContractSql(a)})`;
}

export function usContractEligibleClause(a = "jobs") {
  return sql.raw(usContractEligibleSql(a));
}
