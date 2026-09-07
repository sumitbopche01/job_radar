import type { CanonicalJob, RawPosting, SourceAdapter } from "../types.js";
import { fetchJson } from "../util/http.js";
import { sha256 } from "../util/hash.js";
import { inferRemoteType, normalizeEmploymentType } from "../util/infer.js";

interface SrPosting {
  id: string;
  name: string; // title
  refNumber?: string;
  releasedDate?: string;
  location?: {
    city?: string;
    region?: string;
    country?: string;
    remote?: boolean;
    hybrid?: boolean;
    fullLocation?: string;
  };
  typeOfEmployment?: { id?: string; label?: string };
  company?: { identifier?: string };
}

interface SrResponse {
  offset: number;
  limit: number;
  totalFound: number;
  content: SrPosting[];
}

const PAGE = 100;
const MAX_PAGES = 20; // safety cap (2,000 postings/company)

export const smartrecruitersAdapter: SourceAdapter = {
  id: "smartrecruiters",
  provider: "smartrecruiters",
  rateLimit: { concurrency: 20, minDelayMs: 60 },

  async fetch(target) {
    const raws: RawPosting[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const url = `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(
        target.boardToken,
      )}/postings?limit=${PAGE}&offset=${page * PAGE}`;
      const data = await fetchJson<SrResponse>(url);
      const content = Array.isArray(data?.content) ? data.content : [];
      for (const p of content) {
        raws.push({
          source: "smartrecruiters",
          externalId: String(p.id),
          companyId: target.companyId,
          payload: p,
        });
      }
      if (content.length < PAGE || raws.length >= (data?.totalFound ?? 0)) break;
    }
    return raws;
  },

  normalize(raw: RawPosting, target): CanonicalJob {
    const p = raw.payload as SrPosting;
    const loc = p.location;
    const locationRaw =
      loc?.fullLocation?.trim() ||
      [loc?.city, loc?.region, loc?.country].filter(Boolean).join(", ") ||
      null;
    const postedAt = p.releasedDate ? new Date(p.releasedDate) : null;
    const title = (p.name ?? "").trim();
    const identifier = p.company?.identifier || target.boardToken;
    const workplace = loc?.remote ? "remote" : loc?.hybrid ? "hybrid" : undefined;
    // Postings list carries no description (needs a per-job detail call) — left empty,
    // like Greenhouse without content=true. Enrichment can backfill later.
    const descriptionMd = "";

    return {
      source: "smartrecruiters",
      externalId: String(p.id),
      companyId: target.companyId,
      companyName: target.companyName,
      title,
      descriptionMd,
      locationRaw,
      remoteType: inferRemoteType(locationRaw, workplace),
      employmentType: normalizeEmploymentType(p.typeOfEmployment?.label ?? p.typeOfEmployment?.id),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
      applyUrl: `https://jobs.smartrecruiters.com/${identifier}/${p.id}`,
      contentHash: sha256(`${title}\n${locationRaw ?? ""}`),
    };
  },
};
