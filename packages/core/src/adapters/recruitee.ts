import type { CanonicalJob, RawPosting, SourceAdapter } from "../types.js";
import { fetchJson } from "../util/http.js";
import { htmlToMarkdown } from "../util/html.js";
import { sha256 } from "../util/hash.js";
import { inferRemoteType, normalizeEmploymentType } from "../util/infer.js";

interface RecruiteeOffer {
  id: number | string;
  title: string;
  careers_url?: string;
  careers_apply_url?: string;
  location?: string;
  city?: string;
  country?: string;
  created_at?: string;
  published_at?: string;
  employment_type_code?: string;
  description?: string;
  remote?: boolean;
  hybrid?: boolean;
  on_site?: boolean;
}

interface RecruiteeResponse {
  offers: RecruiteeOffer[];
}

export const recruiteeAdapter: SourceAdapter = {
  id: "recruitee",
  provider: "recruitee",
  rateLimit: { concurrency: 20, minDelayMs: 60 },

  async fetch(target) {
    const url = `https://${encodeURIComponent(target.boardToken)}.recruitee.com/api/offers/`;
    const data = await fetchJson<RecruiteeResponse>(url);
    const offers = Array.isArray(data?.offers) ? data.offers : [];
    return offers.map((o) => ({
      source: "recruitee",
      externalId: String(o.id),
      companyId: target.companyId,
      payload: o,
    }));
  },

  normalize(raw: RawPosting, target): CanonicalJob {
    const o = raw.payload as RecruiteeOffer;
    const descriptionMd = htmlToMarkdown(o.description ?? "");
    const locationRaw = o.location?.trim() || [o.city, o.country].filter(Boolean).join(", ") || null;
    const postedRaw = o.published_at ?? o.created_at ?? null;
    const postedAt = postedRaw ? new Date(postedRaw) : null;
    const title = (o.title ?? "").trim();
    const workplace = o.remote ? "remote" : o.hybrid ? "hybrid" : o.on_site ? "onsite" : undefined;

    return {
      source: "recruitee",
      externalId: String(o.id),
      companyId: target.companyId,
      companyName: target.companyName,
      title,
      descriptionMd,
      locationRaw,
      remoteType: inferRemoteType(locationRaw, workplace),
      employmentType: normalizeEmploymentType(o.employment_type_code),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
      applyUrl: o.careers_apply_url || o.careers_url || "",
      contentHash: sha256(`${title}\n${descriptionMd}`),
    };
  },
};
