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

// ---- shared helpers for the structured remote boards ----
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Paging stops once a page's oldest posting is older than this (fresh window + slack). */
const FRESH_CUTOFF_DAYS = 15;
const freshCutoffMs = () => Date.now() - FRESH_CUTOFF_DAYS * 86_400_000;

/**
 * Structured board metadata (employment type, visa, timezone) written as plain
 * header lines atop the description. The US-access classifier (usRemote.ts) reads
 * these — structured data beats guessing from prose — and they're useful to read.
 */
function withMeta(lines: (string | null | undefined)[], body: string): string {
  const head = lines.filter((l): l is string => Boolean(l && l.trim()));
  return head.length ? `${head.join("\n")}\n\n${body}` : body;
}

/** "Timezone: UTC-8 to UTC-5 (US hours)" for a restricted offset list; null when
 *  unrestricted (Himalayas lists ~37 offsets for "any timezone"). */
function timezoneNote(tz: number[] | undefined): string | null {
  if (!tz || tz.length === 0 || tz.length >= 30) return null;
  const min = Math.min(...tz);
  const max = Math.max(...tz);
  const fmt = (n: number) => `UTC${n >= 0 ? "+" : ""}${n}`;
  const us = max <= -3 && min >= -10;
  const ist = tz.some((t) => Math.abs(t - 5.5) <= 1.5);
  return `Timezone: ${fmt(min)} to ${fmt(max)}${us ? " (US hours)" : ""}${ist ? " (IST-friendly)" : ""}`;
}

// ---- Himalayas (large remote-only board; feed + country search) ----
interface HimalayasJob {
  title: string;
  companyName?: string;
  applicationLink?: string;
  guid?: string;
  employmentType?: string;
  locationRestrictions?: string[];
  timezoneRestrictions?: number[];
  description?: string;
  pubDate?: number; // unix seconds
}

/** Search terms for the India-eligible sweep (each paged newest-first). The first
 *  three always run; the rest cover target titles those miss ("Solutions
 *  Architect", "Member of Technical Staff", "Applied Scientist", "LLM …") and only
 *  run with HIMALAYAS_API_KEY — keyless pacing would make the sweep too slow. */
const HIMALAYAS_INDIA_QUERIES = ["engineer", "developer", "machine learning"];
const HIMALAYAS_INDIA_QUERIES_KEYED = ["architect", "technical staff", "scientist", "llm", "ai"];

function himalayasPosting(j: HimalayasJob, id: string): Posting {
  // locationRestrictions is the ALLOWED-countries set — exactly what the geo
  // allowlist wants ("India"/"Germany"/… present = eligible; empty = worldwide).
  const location = j.locationRestrictions?.length ? j.locationRestrictions.join(", ") : "Remote";
  return {
    company: j.companyName || "Unknown",
    title: j.title,
    location,
    remoteType: "remote",
    applyUrl: j.applicationLink || j.guid || "",
    externalId: `himalayas-${id}`,
    descriptionMd: withMeta(
      [
        j.employmentType ? `Employment type: ${j.employmentType}` : null,
        timezoneNote(j.timezoneRestrictions),
      ],
      htmlToMarkdown(j.description ?? ""),
    ),
    postedAt: j.pubDate ? new Date(j.pubDate * 1000) : null,
  };
}

/** Himalayas headers. The keyless API is rate-limited (429 after ~40 quick
 *  calls); a free developer key (himalayas.app/signup/developer) lifts that —
 *  optional, read from HIMALAYAS_API_KEY. */
function himalayasHeaders(): Record<string, string> {
  const key = process.env.HIMALAYAS_API_KEY;
  return key
    ? { "user-agent": BROWSER_UA, authorization: `Bearer ${key}` }
    : { "user-agent": BROWSER_UA };
}

export async function fetchHimalayas(): Promise<Posting[]> {
  const out: Posting[] = [];
  const seen = new Set<string>();
  const add = (j: HimalayasJob) => {
    const id = j.guid || j.applicationLink || `${j.companyName}-${j.title}`;
    if (!j.title || seen.has(id)) return;
    seen.add(id);
    out.push(himalayasPosting(j, id));
  };

  // 1) newest-first firehose — a handful of pages covers the fresh window.
  let cursor: string | undefined;
  for (let page = 0; page < 6; page++) {
    const url =
      `https://himalayas.app/jobs/api?limit=250` +
      (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
    const data = await fetchJson<{ jobs?: HimalayasJob[]; nextCursor?: string }>(url, {
      timeoutMs: 25_000,
      headers: himalayasHeaders(),
    });
    const jobs = data.jobs ?? [];
    if (jobs.length === 0) break;
    jobs.forEach(add);
    cursor = data.nextCursor;
    if (!cursor) break;
  }

  // 2) India-eligible sweep: `country=India` returns roles whose allowed
  //    countries include India OR that are worldwide — the US-company-hiring-
  //    from-India set the firehose's 1.5k newest rows mostly miss. 20/page,
  //    newest-first; stop once a page is older than the fresh window.
  //    Best-effort: a rate limit (or any error) ends the sweep but KEEPS what was
  //    already collected — it must never throw away the firehose results.
  const keyed = Boolean(process.env.HIMALAYAS_API_KEY);
  const pace = keyed ? 300 : 1200;
  const queries = keyed ? [...HIMALAYAS_INDIA_QUERIES, ...HIMALAYAS_INDIA_QUERIES_KEYED] : HIMALAYAS_INDIA_QUERIES;
  sweep: for (const q of queries) {
    for (let page = 1; page <= 30; page++) {
      let jobs: HimalayasJob[];
      try {
        const data = await fetchJson<{ jobs?: HimalayasJob[] }>(
          `https://himalayas.app/jobs/api/search?country=India&sort=recent&q=${encodeURIComponent(q)}&page=${page}`,
          { timeoutMs: 25_000, headers: himalayasHeaders() },
        );
        jobs = data.jobs ?? [];
      } catch (err) {
        console.warn(
          `[himalayas] India sweep stopped at q="${q}" page ${page}: ${err instanceof Error ? err.message.slice(0, 80) : err}`,
        );
        break sweep;
      }
      if (jobs.length === 0) break;
      jobs.forEach(add);
      const oldest = Math.min(...jobs.map((j) => (j.pubDate ?? 0) * 1000));
      if (oldest < freshCutoffMs()) break;
      await sleep(pace);
    }
  }
  return out;
}

// ---- Jobicy (remote board with a structured jobGeo field; cursor-paged API) ----
interface JobicyJob {
  id: number | string;
  url: string;
  jobTitle: string;
  companyName?: string;
  jobType?: string[] | string;
  jobGeo?: string;
  jobLevel?: string;
  jobDescription?: string;
  pubDate?: string;
}
/** US + worldwide + APAC are the geos an India-based contractor can work. */
const JOBICY_GEOS = ["usa", "anywhere", "apac"];
const JOBICY_INDUSTRIES = ["engineering", "data-science"];

export async function fetchJobicy(): Promise<Posting[]> {
  const out: Posting[] = [];
  const seen = new Set<string>();
  for (const geo of JOBICY_GEOS) {
    for (const industry of JOBICY_INDUSTRIES) {
      let cursor: string | undefined;
      for (let page = 0; page < 4; page++) {
        const data = await fetchJson<{ jobs?: JobicyJob[]; nextCursor?: string; hasMore?: boolean }>(
          `https://jobicy.com/api/v2/remote-jobs?count=100&geo=${geo}&industry=${industry}` +
            (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""),
          { timeoutMs: 25_000, headers: { "user-agent": BROWSER_UA } },
        );
        for (const j of data.jobs ?? []) {
          const id = String(j.id);
          if (!j.jobTitle || seen.has(id)) continue;
          seen.add(id);
          const types = Array.isArray(j.jobType) ? j.jobType : j.jobType ? [j.jobType] : [];
          out.push({
            company: j.companyName || "Unknown",
            title: decodeEntities(j.jobTitle),
            // jobGeo is the allowed-geo list ("USA", "Canada,  USA", "Anywhere", "APAC")
            location: (j.jobGeo ?? "Anywhere").replace(/\s*,\s*/g, ", ").trim(),
            remoteType: "remote",
            applyUrl: j.url,
            externalId: `jobicy-${id}`,
            descriptionMd: withMeta(
              [types.length ? `Employment type: ${types.join(", ")}` : null],
              htmlToMarkdown(j.jobDescription ?? ""),
            ),
            postedAt: j.pubDate ? new Date(j.pubDate) : null,
          });
        }
        cursor = data.nextCursor;
        if (!data.hasMore || !cursor) break;
        await sleep(250);
      }
    }
  }
  return out;
}

// ---- Real Work From Anywhere (location-independent only; RSS) ----
export async function fetchRealWorkFromAnywhere(): Promise<Posting[]> {
  const xml = await fetchText("https://www.realworkfromanywhere.com/rss.xml", {
    headers: { "user-agent": BROWSER_UA },
    timeoutMs: 20_000,
  });
  const out: Posting[] = [];
  const seen = new Set<string>();
  for (const chunk of xml.split("<item>").slice(1)) {
    const item = chunk.split("</item>")[0] ?? "";
    const rawTitle = decodeEntities((xmlTag(item, "title") ?? "").trim());
    const link = (xmlTag(item, "link") || xmlTag(item, "guid") || "").trim();
    if (!rawTitle || !link || seen.has(link)) continue;
    seen.add(link);
    // titles are "Position at Company"
    const at = rawTitle.lastIndexOf(" at ");
    const pub = xmlTag(item, "pubDate");
    out.push({
      company: at > 0 ? rawTitle.slice(at + 4).trim() : "Unknown",
      title: at > 0 ? rawTitle.slice(0, at).trim() : rawTitle,
      location: "Anywhere in the World", // the board only lists fully location-independent roles
      remoteType: "remote",
      applyUrl: link,
      externalId: `rwfa-${link.split("/").filter(Boolean).pop() ?? link}`,
      descriptionMd: htmlToMarkdown(xmlTag(item, "description") ?? ""),
      postedAt: pub ? new Date(pub) : null,
    });
  }
  return out;
}

// ---- Y Combinator job board (remote; each posting carries a `visa` field) ----
interface YcPosting {
  id: number;
  title: string;
  url: string; // "/companies/<slug>/jobs/<id>-<slug>"
  location?: string;
  type?: string; // "Full-time" | "Contract" | "Internship" …
  visa?: string; // "US citizen/visa only" | "US citizenship/visa not required" | "Will sponsor"
  companyName?: string;
  createdAt?: string; // relative: "6 months", "about 1 year", "5 days"
}
const YC_ROLES = ["software-engineer", "science"];

/** YC embeds page props as entity-encoded JSON in `data-page="…"`. */
function ycPageProps(html: string): Record<string, unknown> | null {
  const m = html.match(/data-page="([^"]+)"/);
  if (!m?.[1]) return null;
  try {
    return (JSON.parse(decodeEntities(m[1])) as { props?: Record<string, unknown> }).props ?? null;
  } catch {
    return null;
  }
}

/** "about 1 year" / "6 months" / "less than a minute" -> approximate Date. */
export function relativeAgeToDate(s: string | undefined, now = Date.now()): Date | null {
  const m = (s ?? "").toLowerCase().match(/(\d+|an?|one)\s*(minute|hour|day|week|month|year)/);
  if (!m?.[1] || !m[2]) return null;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : 1;
  const unit: Record<string, number> = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 604_800_000,
    month: 2_592_000_000,
    year: 31_536_000_000,
  };
  return new Date(now - n * (unit[m[2]] ?? 0));
}

/** Map YC's visa field to a header line the US classifier understands. */
function ycVisaLine(visa: string | undefined): string | null {
  const v = (visa ?? "").toLowerCase();
  if (!v) return null;
  if (v.includes("not required")) return "Work authorization: not required (open to international candidates)";
  if (v.includes("citizen/visa only")) return "Work authorization: US citizen or US visa holder only";
  if (v.includes("sponsor")) return "Work authorization: US visa sponsorship offered (relocation to the US)";
  return `Work authorization: ${visa}`;
}

export async function fetchYcJobs(): Promise<Posting[]> {
  const out: Posting[] = [];
  const seen = new Set<number>();
  for (const role of YC_ROLES) {
    const html = await fetchText(`https://www.ycombinator.com/jobs/role/${role}/remote`, {
      headers: { "user-agent": BROWSER_UA },
      timeoutMs: 25_000,
    });
    const postings = (ycPageProps(html)?.jobPostings as YcPosting[] | undefined) ?? [];
    for (const p of postings) {
      if (!p.title || seen.has(p.id)) continue;
      seen.add(p.id);
      const postedAt = relativeAgeToDate(p.createdAt);
      if (postedAt && postedAt.getTime() < freshCutoffMs() - 45 * 86_400_000) continue; // skip stale
      // the listing has no description — one detail fetch per (fresh) posting
      let description = "";
      try {
        const detail = ycPageProps(
          await fetchText(`https://www.ycombinator.com${p.url}`, {
            headers: { "user-agent": BROWSER_UA },
            timeoutMs: 20_000,
          }),
        );
        const job = detail?.job as { description?: string } | undefined;
        description = job?.description ?? "";
      } catch {
        // keep the posting even if the detail page fails
      }
      await sleep(300);
      const visaOpen = (p.visa ?? "").toLowerCase().includes("not required");
      let location = p.location?.trim() || "Remote";
      // A bare "Remote" YC posting that waives US work authorization is a US
      // startup hiring internationally — say so, so it lands in the USA view.
      if (visaOpen && /^remote$/i.test(location)) location = "Remote (US company, international OK)";
      out.push({
        company: p.companyName || "Unknown",
        title: p.title,
        location,
        remoteType: "remote",
        applyUrl: `https://www.ycombinator.com${p.url}`,
        externalId: `yc-${p.id}`,
        descriptionMd: withMeta(
          [p.type ? `Employment type: ${p.type}` : null, ycVisaLine(p.visa)],
          description.includes("<") ? htmlToMarkdown(description) : description,
        ),
        postedAt,
      });
    }
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

// ---- Working Nomads (curated remote; JSON API with a real location field) ----
interface WorkingNomadsJob {
  url: string;
  title: string;
  description?: string;
  company_name?: string;
  location?: string;
  pub_date?: string;
}

export async function fetchWorkingNomads(): Promise<Posting[]> {
  const data = await fetchJson<WorkingNomadsJob[]>(
    "https://www.workingnomads.com/api/exposed_jobs/",
    { timeoutMs: 20_000, headers: { "user-agent": BROWSER_UA } },
  );
  const out: Posting[] = [];
  for (const j of data ?? []) {
    if (!j.url || !j.title) continue;
    out.push({
      company: j.company_name || "Unknown",
      title: j.title,
      location: j.location?.trim() || "Remote",
      remoteType: "remote",
      applyUrl: j.url,
      externalId: `workingnomads-${j.url.split("/").filter(Boolean).pop() ?? j.url}`,
      descriptionMd: htmlToMarkdown(j.description ?? ""),
      postedAt: j.pub_date ? new Date(j.pub_date) : null,
    });
  }
  return out;
}

// ---- NoDesk (curated remote; RSS, titles "Position at Company", no geo field) ----
export async function fetchNoDesk(): Promise<Posting[]> {
  const xml = await fetchText("https://nodesk.co/remote-jobs/index.xml", {
    headers: { "user-agent": BROWSER_UA },
    timeoutMs: 20_000,
  });
  const out: Posting[] = [];
  const seen = new Set<string>();
  for (const chunk of xml.split("<item>").slice(1)) {
    const item = chunk.split("</item>")[0] ?? "";
    const rawTitle = decodeEntities((xmlTag(item, "title") ?? "").trim());
    const link = (xmlTag(item, "link") || xmlTag(item, "guid") || "").trim();
    if (!rawTitle || !link || seen.has(link)) continue;
    seen.add(link);
    const at = rawTitle.lastIndexOf(" at ");
    const title = at > 0 ? rawTitle.slice(0, at).trim() : rawTitle;
    const company = at > 0 ? rawTitle.slice(at + 4).trim() : "Unknown";
    const pub = xmlTag(item, "pubDate");
    out.push({
      company,
      title,
      location: null, // feed carries no structured location; curated remote
      remoteType: "remote",
      applyUrl: link,
      externalId: `nodesk-${link.split("/").filter(Boolean).pop() ?? link}`,
      descriptionMd: htmlToMarkdown(xmlTag(item, "description") ?? ""),
      postedAt: pub ? new Date(pub) : null,
    });
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
    ["workingnomads", fetchWorkingNomads],
    ["nodesk", fetchNoDesk],
    // US-remote-from-India sources (geo/visa-structured)
    ["jobicy", fetchJobicy],
    ["rwfa", fetchRealWorkFromAnywhere],
    ["yc", fetchYcJobs],
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
