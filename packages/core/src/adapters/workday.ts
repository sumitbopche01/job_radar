import type { CanonicalJob, RawPosting, SourceAdapter } from "../types.js";
import { fetchJson } from "../util/http.js";
import { sha256 } from "../util/hash.js";
import { inferRemoteType } from "../util/infer.js";

interface WdPosting {
  title: string;
  externalPath: string; // "/job/City/Title_JR123"
  locationsText?: string;
  postedOn?: string; // relative, e.g. "Posted Today", "Posted 5 Days Ago"
  bulletFields?: string[]; // [reqId]
}

interface WdResponse {
  total: number;
  jobPostings: WdPosting[];
}

const PAGE = 20;
const MAX_PAGES = 100; // 2,000 postings/company cap

/** Parse Workday's relative "Posted X" text into an approximate date. */
function parsePostedOn(s: string | undefined): Date | null {
  if (!s) return null;
  const t = s.toLowerCase();
  if (t.includes("today")) return new Date();
  if (t.includes("yesterday")) return new Date(Date.now() - 86400_000);
  const m = t.match(/(\d+)\+?\s*day/);
  if (m) return new Date(Date.now() - Number(m[1]) * 86400_000);
  return null;
}

/**
 * Workday. companies.workday_tenant holds the full host (e.g.
 * "nvidia.wd5.myworkdayjobs.com"), companies.workday_site the career-site name
 * (e.g. "NVIDIAExternalCareerSite"). List is metadata-only (no description; dates
 * are relative) — enrichment/detail can backfill.
 */
export const workdayAdapter: SourceAdapter = {
  id: "workday",
  provider: "workday",
  rateLimit: { concurrency: 30, minDelayMs: 50 },

  async fetch(target) {
    const host = target.workdayTenant;
    const site = target.workdaySite;
    if (!host || !site) return [];
    const tenant = host.split(".")[0];
    const url = `https://${host}/wday/cxs/${tenant}/${site}/jobs`;

    const raws: RawPosting[] = [];
    let total = Infinity; // Workday reports the real total only on page 0
    for (let page = 0; page < MAX_PAGES && page * PAGE < total; page++) {
      const data = await fetchJson<WdResponse>(url, {
        method: "POST",
        body: { appliedFacets: {}, limit: PAGE, offset: page * PAGE, searchText: "" },
      });
      if (page === 0) total = data?.total ?? 0;
      const postings = Array.isArray(data?.jobPostings) ? data.jobPostings : [];
      if (postings.length === 0) break;
      for (const p of postings) {
        const externalId = p.bulletFields?.[0] || p.externalPath;
        raws.push({ source: "workday", externalId, companyId: target.companyId, payload: p });
      }
    }
    return raws;
  },

  normalize(raw: RawPosting, target): CanonicalJob {
    const p = raw.payload as WdPosting;
    const host = target.workdayTenant ?? "";
    const site = target.workdaySite ?? "";
    const title = (p.title ?? "").trim();
    const locationRaw = p.locationsText?.trim() || null;
    const externalId = p.bulletFields?.[0] || p.externalPath;
    const applyUrl = `https://${host}/en-US/${site}${p.externalPath}`;

    return {
      source: "workday",
      externalId,
      companyId: target.companyId,
      companyName: target.companyName,
      title,
      descriptionMd: "",
      locationRaw,
      remoteType: inferRemoteType(locationRaw),
      employmentType: "unknown",
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      postedAt: parsePostedOn(p.postedOn),
      applyUrl,
      contentHash: sha256(`${title}\n${locationRaw ?? ""}`),
    };
  },
};
