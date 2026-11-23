import { sql } from "drizzle-orm";

/**
 * AI-training / data-labeling gig work (RemoteJobsOne, micro1, Mercor-style
 * "help train an AI model, ~15 h/week" listings). They're contract and worldwide,
 * so they sail through the geo gate and the US view — but they aren't engineering
 * jobs, and one marketplace can post 50 near-identical rows that bury real roles.
 *
 * Phrases are deliberately specific: bare "RLHF" / "annotation" appear in
 * legitimate AI-engineer JDs ("experience with RLHF pipelines") and are NOT here.
 */
const GIG_DESC_BODIES = [
  "ai training project",
  "contribute to an? ai training",
  "help (us )?train (an? )?(ai|llm|large language) models?",
  "data annotation (project|work|tasks)",
  "annotation project",
  "rlhf (project|tasks)",
  "evaluate ai[- ]generated (responses|outputs|code)",
];
const GIG_TITLE_BODIES = ["ai trainer", "ai training", "data annotator", "data annotation"];

/**
 * AI-training / data-labeling marketplaces that repost dozens of near-identical
 * "Remote (Worldwide)" listings (incl. bait like "MTS — $600k–$1.8M/yr") whose
 * copy varies too much for phrase matching. Exact lower-cased company names.
 * NOT here on purpose: Lemon.io, Proxify, Turing, Toptal, Arc — those place
 * developers in real contract *engineering* roles (the B2B-contract route).
 */
export const GIG_COMPANY_BLOCKLIST = [
  "remotejobsone",
  "micro1",
  "mercor",
  "welocalize",
  "outlier",
  "outlier ai",
  "dataannotation",
  "dataannotation.tech",
  "alignerr",
  "toloka",
  "appen",
  "prolific",
];

const jsRe = (b: string[]) => new RegExp(`\\b(${b.join("|")})\\b`, "i");
const pgRe = (b: string[]) => `\\y(${b.join("|")})\\y`;
const GIG_DESC_RE = jsRe(GIG_DESC_BODIES);
const GIG_TITLE_RE = jsRe(GIG_TITLE_BODIES);

/** JS mirror (tests / in-memory). */
export function isAiTrainingGig(title: string | null | undefined, desc: string | null | undefined): boolean {
  return GIG_TITLE_RE.test(title ?? "") || GIG_DESC_RE.test(desc ?? "");
}

/** SQL: the job is NOT an AI-training gig. Applied beside languageOkClause in
 *  every candidate query. The company check is a subquery so it works whether or
 *  not the caller joined `companies`. */
export function gigExclusionClause(alias = "jobs") {
  const names = GIG_COMPANY_BLOCKLIST.map((n) => `'${n}'`).join(", ");
  return sql.raw(
    `(lower(coalesce(${alias}.title, '')) !~ '${pgRe(GIG_TITLE_BODIES)}'` +
      ` and lower(coalesce(${alias}.description_md, '')) !~ '${pgRe(GIG_DESC_BODIES)}'` +
      ` and ${alias}.company_id not in (select gc.id from companies gc where lower(gc.name) in (${names})))`,
  );
}
