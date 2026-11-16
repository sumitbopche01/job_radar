import { sql } from "drizzle-orm";

/**
 * Foreign-language requirement filter. Many European roles require native/fluent
 * command of a non-English language (e.g. "Native-level German proficiency is
 * required") — buried in the JD body, not the title. The candidate speaks English
 * (+ Hindi) but not these, so a HARD language requirement makes the role a dead end.
 *
 * We detect a *requirement* (native / fluent / required / mandatory near the
 * language) but NOT an *optional* mention ("German is a plus", "nice to have:
 * Spanish", "German is a plus but not required"). English is never a disqualifier.
 *
 * Description-based: list-only sources (Workday/Oracle/SmartRecruiters) have no
 * description, so nothing is detected there (kept, not wrongly dropped).
 */

export const FOREIGN_LANGUAGES = [
  "german",
  "french",
  "dutch",
  "spanish",
  "italian",
  "portuguese",
  "polish",
  "swedish",
  "danish",
  "norwegian",
  "finnish",
  "czech",
  "romanian",
  "hungarian",
  "greek",
  "turkish",
  "arabic",
  "hebrew",
  "mandarin",
  "cantonese",
  "japanese",
  "korean",
  "russian",
  "ukrainian",
];

const LANGS = FOREIGN_LANGUAGES.join("|");
const LEVEL = "native|fluent|fluency|proficien|mother ?tongue|bilingual|business[ -]level|c1 |c2 ";
const NEED = "required|mandatory|essential|must speak|is a must";
// Markers that turn a requirement into a nice-to-have.
const OPTIONAL = "plus|bonus|advantage|nice[ -]to[ -]have|optional|preferred|desirable|beneficial|not required|not mandatory|would be a";

// A requirement if a proficiency/need word sits within ~40 chars of a language,
// in either order. `[^.]` keeps it within one sentence-ish window.
const REQ_PATTERN =
  `(${LEVEL}|${NEED})[^.]{0,40}(${LANGS})` + `|` + `(${LANGS})[^.]{0,40}(${LEVEL}|${NEED})`;
// An optional marker sitting near a language — overrides a requirement hit.
const OPT_PATTERN =
  `(${OPTIONAL})[^.]{0,30}(${LANGS})` + `|` + `(${LANGS})[^.]{0,30}(${OPTIONAL})`;

const OPT_RE = new RegExp(OPT_PATTERN, "i");
const REQ_WORD_RE = new RegExp(`\\b(${LEVEL}|${NEED})`, "i");

/**
 * Returns the required foreign language (lowercased) if the JD hard-requires one,
 * else null. Works sentence by sentence: an optional marker in a sentence ("German
 * is a plus") disqualifies that sentence from counting as a requirement.
 */
export function detectLanguageRequirement(description: string | null | undefined): string | null {
  const d = (description ?? "").toLowerCase();
  if (!d) return null;
  for (const sentence of d.split(/[.\n;•]/)) {
    if (OPT_RE.test(sentence)) continue; // "german is a plus" — not a hard requirement
    const lang = FOREIGN_LANGUAGES.find((l) => sentence.includes(l));
    if (!lang) continue;
    if (REQ_WORD_RE.test(sentence)) return lang;
  }
  return null;
}

/** SQL: TRUE when the job does NOT hard-require a foreign language (keyed to alias). */
export function languageOkClause(alias = "jobs") {
  const desc = `lower(coalesce(${alias}.description_md, ''))`;
  // Keep if no requirement match, OR an optional marker sits near a language
  // (coarse gate — the precise call is detectLanguageRequirement). POSIX ERE.
  const req = REQ_PATTERN.replace(/'/g, "''");
  const opt = OPT_PATTERN.replace(/'/g, "''");
  return sql.raw(`(${desc} !~ '${req}' or ${desc} ~ '${opt}')`);
}
