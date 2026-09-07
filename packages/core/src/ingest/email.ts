import type { Db } from "../db/client.js";
import { decodeEntities } from "../util/html.js";
import { inferRemoteType } from "../util/infer.js";
import { ingestPostings, type IngestResult, type Posting } from "./index.js";

export type AlertProvider = "linkedin" | "wellfound" | "naukri" | "instahyre" | "generic";

/** Per-provider regex capturing (jobId) from a job link in an alert email. */
const JOB_LINK: Record<Exclude<AlertProvider, "generic">, RegExp> = {
  linkedin: /https?:\/\/[^"']*linkedin\.com\/(?:comm\/)?jobs\/view\/(\d+)/gi,
  wellfound: /https?:\/\/[^"']*(?:wellfound|angel)\.co\/[^"']*?\/jobs\/(\d+)/gi,
  naukri: /https?:\/\/[^"']*naukri\.com\/job-listings[^"']*?-(\d+)/gi,
  instahyre: /https?:\/\/[^"']*instahyre\.com\/[^"']*?\/(\d+)/gi,
};

function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/**
 * Parse a job-alert email's HTML into postings (design §4 Tier 3). Alert emails are
 * a list of job cards: a link to the posting (title as its text), then the company
 * and location in nearby text. Heuristic and provider-shaped — tune the patterns
 * against a real sample. Each posting's applyUrl is the email's link (a tracking
 * redirect that resolves to the real posting).
 */
export function parseAlertEmail(html: string, provider?: AlertProvider): Posting[] {
  const prov: AlertProvider =
    provider ??
    (/linkedin\.com/i.test(html)
      ? "linkedin"
      : /wellfound|angel\.co/i.test(html)
        ? "wellfound"
        : /naukri\.com/i.test(html)
          ? "naukri"
          : /instahyre\.com/i.test(html)
            ? "instahyre"
            : "generic");
  if (prov === "generic") return [];

  const re = JOB_LINK[prov];
  const postings: Posting[] = [];
  const seen = new Set<string>();

  // Find each job anchor: <a href="...jobs/view/123...">Title</a>. The trailing
  // context is sliced separately (not captured) so it doesn't swallow the next anchor.
  const anchorRe = /<a\b[^>]*href=["']([^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const m of html.matchAll(anchorRe)) {
    const href = decodeEntities(m[1]!);
    re.lastIndex = 0;
    const idMatch = re.exec(href);
    if (!idMatch) continue;
    const jobId = idMatch[1]!;
    if (seen.has(jobId)) continue;
    seen.add(jobId);

    const title = stripTags(m[2]!);
    if (!title) continue;
    // company/location: the first two non-empty text lines after the title link,
    // up to the next anchor
    const end = m.index! + m[0].length;
    const nextAnchor = html.indexOf("<a", end);
    const contextEnd = nextAnchor === -1 ? Math.min(end + 400, html.length) : nextAnchor;
    const after = stripTags(html.slice(end, contextEnd))
      .split(/[·|\n]|(?: {2,})/)
      .map((s) => s.trim())
      .filter(Boolean);
    const company = after[0] ?? "Unknown";
    const location = after[1] ?? null;

    postings.push({
      company,
      title,
      location,
      remoteType: inferRemoteType(location),
      applyUrl: href,
      externalId: `${prov}-${jobId}`,
      descriptionMd: "",
      postedAt: null,
    });
  }
  return postings;
}

export interface EmailIngestResult extends IngestResult {
  provider: AlertProvider;
  parsed: number;
}

/** Parse an alert email's HTML and ingest the postings. */
export async function ingestAlertEmail(
  db: Db,
  html: string,
  provider?: AlertProvider,
): Promise<EmailIngestResult> {
  const postings = parseAlertEmail(html, provider);
  const prov = provider ?? (postings[0]?.externalId.split("-")[0] as AlertProvider) ?? "generic";
  const res = await ingestPostings(db, prov === "generic" ? "email" : prov, postings);
  return { ...res, provider: prov, parsed: postings.length };
}
