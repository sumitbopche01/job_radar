import type { Db } from "../db/client.js";
import { fetchJson, fetchText } from "../util/http.js";
import { htmlToMarkdown, decodeEntities } from "../util/html.js";
import { inferRemoteType } from "../util/infer.js";
import { ingestPostings, type IngestResult, type Posting } from "./index.js";

const BROWSER_UA = "Mozilla/5.0 (compatible; job-radar/0.1)";

// ---- Remotive (remote-only, rich; per-category) ----
interface RemotiveJob {
  id: number;
  url: string;
  title: string;
  company_name: string;
  job_type?: string;
  publication_date?: string;
  candidate_required_location?: string;
  description?: string;
}
const REMOTIVE_CATEGORIES = ["software-dev", "devops-sysadmin", "data"];

export async function fetchRemotive(): Promise<Posting[]> {
  const out: Posting[] = [];
  const seen = new Set<number>();
  for (const cat of REMOTIVE_CATEGORIES) {
    const data = await fetchJson<{ jobs?: RemotiveJob[] }>(
      `https://remotive.com/api/remote-jobs?category=${cat}`,
      { timeoutMs: 20_000 },
    );
    for (const j of data.jobs ?? []) {
      if (seen.has(j.id)) continue;
      seen.add(j.id);
      // candidate_required_location IS the geo constraint (e.g. "Worldwide", "USA Only")
      const location = j.candidate_required_location?.trim() || "Remote";
      out.push({
        company: j.company_name,
        title: j.title,
        location,
        remoteType: "remote",
        applyUrl: j.url,
        externalId: `remotive-${j.id}`,
        descriptionMd: htmlToMarkdown(j.description ?? ""),
        postedAt: j.publication_date ? new Date(j.publication_date) : null,
      });
    }
  }
  return out;
}

// ---- RemoteOK (all categories mixed; needs a browser UA) ----
interface RemoteOkJob {
  id?: string;
  position?: string;
  company?: string;
  url?: string;
  apply_url?: string;
  location?: string;
  date?: string;
  description?: string;
}

export async function fetchRemoteOk(): Promise<Posting[]> {
  const data = await fetchJson<RemoteOkJob[]>("https://remoteok.com/api", {
    timeoutMs: 20_000,
    headers: { "user-agent": BROWSER_UA },
  });
  const out: Posting[] = [];
  for (const j of data) {
    if (!j.id || !j.position) continue; // [0] is a legal/metadata entry
    const location = j.location?.trim() || "Remote";
    out.push({
      company: j.company ?? "Unknown",
      title: j.position,
      location,
      remoteType: "remote",
      applyUrl: j.apply_url || j.url || "",
      externalId: `remoteok-${j.id}`,
      descriptionMd: htmlToMarkdown(j.description ?? ""),
      postedAt: j.date ? new Date(j.date) : null,
    });
  }
  return out;
}

// ---- Arbeitnow (EU-heavy, mixed remote/onsite) ----
interface ArbeitnowJob {
  slug: string;
  company_name: string;
  title: string;
  description?: string;
  remote?: boolean;
  url: string;
  location?: string;
  created_at?: number;
}

export async function fetchArbeitnow(): Promise<Posting[]> {
  const data = await fetchJson<{ data?: ArbeitnowJob[] }>(
    "https://www.arbeitnow.com/api/job-board-api",
    { timeoutMs: 20_000 },
  );
  return (data.data ?? []).map((j) => ({
    company: j.company_name,
    title: j.title,
    location: j.location ?? (j.remote ? "Remote" : null),
    remoteType: inferRemoteType(j.location, j.remote ? "remote" : undefined),
    applyUrl: j.url,
    externalId: `arbeitnow-${j.slug}`,
    descriptionMd: htmlToMarkdown(j.description ?? ""),
    postedAt: j.created_at ? new Date(j.created_at * 1000) : null,
  }));
}

// ---- Himalayas (large remote-only board; JSON API with cursor pagination) ----
interface HimalayasJob {
  title: string;
  companyName?: string;
  applicationLink?: string;
  guid?: string;
  locationRestrictions?: string[];
  description?: string;
  pubDate?: number; // unix seconds
}

export async function fetchHimalayas(): Promise<Posting[]> {
  const out: Posting[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  // newest-first feed; a handful of pages covers the fresh window. The geo gate
  // drops the many non-eligible (US-only etc.) rows at query time.
  for (let page = 0; page < 6; page++) {
    const url =
      `https://himalayas.app/jobs/api?limit=250` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const data = await fetchJson<{ jobs?: HimalayasJob[]; nextCursor?: string }>(url, {
      timeoutMs: 25_000,
      headers: { "user-agent": BROWSER_UA },
    });
    const jobs = data.jobs ?? [];
    if (jobs.length === 0) break;
    for (const j of jobs) {
      const id = j.guid || j.applicationLink || `${j.companyName}-${j.title}`;
      if (!j.title || seen.has(id)) continue;
      seen.add(id);
      // locationRestrictions is the ALLOWED-countries set — exactly what the geo
      // allowlist wants ("India"/"Germany"/… present = eligible; empty = worldwide).
      const location = j.locationRestrictions?.length ? j.locationRestrictions.join(", ") : "Remote";
      out.push({
        company: j.companyName || "Unknown",
        title: j.title,
        location,
        remoteType: "remote",
        applyUrl: j.applicationLink || j.guid || "",
        externalId: `himalayas-${id}`,
        descriptionMd: htmlToMarkdown(j.description ?? ""),
        postedAt: j.pubDate ? new Date(j.pubDate * 1000) : null,
      });
    }
    cursor = data.nextCursor;
    if (!cursor) break;
  }
  return out;
}

// ---- We Work Remotely (per-category RSS/XML) ----
const WWR_FEEDS = [
  "https://weworkremotely.com/categories/remote-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-devops-sysadmin-jobs.rss",
];

/** Pull the first `<name>…</name>` out of an RSS item block (handles CDATA). */
function xmlTag(block: string, name: string): string | null {
  const m = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i"));
  const raw = m?.[1];
  if (raw == null) return null;
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return cdata?.[1] ?? raw;
}

export async function fetchWeWorkRemotely(): Promise<Posting[]> {
  const out: Posting[] = [];
  const seen = new Set<string>();
  for (const feed of WWR_FEEDS) {
    const xml = await fetchText(feed, { headers: { "user-agent": BROWSER_UA }, timeoutMs: 20_000 });
    for (const chunk of xml.split("<item>").slice(1)) {
      const item = chunk.split("</item>")[0] ?? "";
      const title = decodeEntities((xmlTag(item, "title") ?? "").trim());
      const link = (xmlTag(item, "link") || xmlTag(item, "guid") || "").trim();
      if (!title || !link || seen.has(link)) continue;
      seen.add(link);
      // WWR titles are "Company: Position"
      const i = title.indexOf(": ");
      const company = i > 0 ? title.slice(0, i).trim() : "Unknown";
      const position = i > 0 ? title.slice(i + 2).trim() : title;
      const pub = xmlTag(item, "pubDate");
      out.push({
        company,
        title: position,
        location: decodeEntities((xmlTag(item, "region") ?? "").trim()) || "Remote",
        remoteType: "remote",
        applyUrl: link,
        externalId: `wwr-${link.split("/").pop() ?? link}`,
        descriptionMd: htmlToMarkdown(xmlTag(item, "description") ?? ""),
        postedAt: pub ? new Date(pub) : null,
      });
    }
  }
  return out;
}

export interface RemoteBoardsResult {
  boards: Record<string, IngestResult & { fetched: number }>;
}

/** Ingest the free Tier-2 remote job boards (design §4). Each is stored like any
 *  other source, so the geo/role gates and dedupe apply. */
export async function ingestRemoteBoards(db: Db): Promise<RemoteBoardsResult> {
  const boards: RemoteBoardsResult["boards"] = {};
  const sources: [string, () => Promise<Posting[]>][] = [
    ["remotive", fetchRemotive],
    ["remoteok", fetchRemoteOk],
    ["arbeitnow", fetchArbeitnow],
    ["himalayas", fetchHimalayas],
    ["wwr", fetchWeWorkRemotely],
  ];
  for (const [name, fetcher] of sources) {
    try {
      const postings = await fetcher();
      const res = await ingestPostings(db, name, postings);
      boards[name] = { ...res, fetched: postings.length };
    } catch (err) {
      boards[name] = {
        processed: 0,
        companies: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        fetched: 0,
        // surface the error in the summary
        ...({ error: err instanceof Error ? err.message : String(err) } as object),
      };
    }
  }
  return { boards };
}
