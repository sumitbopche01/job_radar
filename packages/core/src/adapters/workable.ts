import type { CanonicalJob, RawPosting, SourceAdapter } from "../types.js";
import { fetchJson } from "../util/http.js";
import { htmlToMarkdown } from "../util/html.js";
import { sha256 } from "../util/hash.js";
import { inferRemoteType, normalizeEmploymentType } from "../util/infer.js";

interface WorkableJob {
  id?: string;
  shortcode?: string;
  title?: string;
  full_title?: string;
  employment_type?: string;
  telecommuting?: boolean;
  department?: string;
  url?: string;
  shortlink?: string;
  application_url?: string;
  published_on?: string;
  created_at?: string;
  country?: string;
  city?: string;
  state?: string;
  description?: string;
  requirements?: string;
  benefits?: string;
}

interface WorkableResponse {
  jobs: WorkableJob[];
}

export const workableAdapter: SourceAdapter = {
  id: "workable",
  provider: "workable",
  // Workable has tight rate limits (design doc §4) — keep concurrency low.
  rateLimit: { concurrency: 5, minDelayMs: 150 },

  async fetch(target) {
    const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(
      target.boardToken,
    )}?details=true`;
    const data = await fetchJson<WorkableResponse>(url);
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    return jobs.map((j) => ({
      source: "workable",
      externalId: String(j.shortcode ?? j.id),
      companyId: target.companyId,
      payload: j,
    }));
  },

  normalize(raw: RawPosting, target): CanonicalJob {
    const j = raw.payload as WorkableJob;
    const body = [j.description ?? "", j.requirements ?? "", j.benefits ?? ""].filter(Boolean).join("\n");
    const descriptionMd = htmlToMarkdown(body);
    const locationRaw = [j.city, j.state, j.country].filter(Boolean).join(", ") || null;
    const postedRaw = j.published_on ?? j.created_at ?? null;
    const postedAt = postedRaw ? new Date(postedRaw) : null;
    const title = (j.title ?? j.full_title ?? "").trim();

    return {
      source: "workable",
      externalId: String(j.shortcode ?? j.id),
      companyId: target.companyId,
      companyName: target.companyName,
      title,
      descriptionMd,
      locationRaw,
      remoteType: inferRemoteType(locationRaw, j.telecommuting ? "remote" : undefined),
      employmentType: normalizeEmploymentType(j.employment_type),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
      applyUrl: j.application_url || j.url || j.shortlink || "",
      contentHash: sha256(`${title}\n${descriptionMd}`),
    };
  },
};
