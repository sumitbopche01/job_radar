import type { CanonicalJob, RawPosting, SourceAdapter } from "../types.js";
import { fetchJson } from "../util/http.js";
import { htmlToMarkdown } from "../util/html.js";
import { sha256 } from "../util/hash.js";
import { inferRemoteType } from "../util/infer.js";

interface GhJob {
  id: number;
  title: string;
  absolute_url: string;
  location?: { name?: string } | null;
  updated_at?: string;
  first_published?: string;
  content?: string; // HTML, entity-encoded (needs content=true)
  company_name?: string;
}

interface GhResponse {
  jobs: GhJob[];
}

export const greenhouseAdapter: SourceAdapter = {
  id: "greenhouse",
  provider: "greenhouse",
  rateLimit: { concurrency: 30, minDelayMs: 50 },

  async fetch(target) {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(
      target.boardToken,
    )}/jobs?content=true`;
    const data = await fetchJson<GhResponse>(url);
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    return jobs.map((j) => ({
      source: "greenhouse",
      externalId: String(j.id),
      companyId: target.companyId,
      payload: j,
    }));
  },

  normalize(raw: RawPosting, target): CanonicalJob {
    const j = raw.payload as GhJob;
    const descriptionMd = htmlToMarkdown(j.content ?? "");
    const locationRaw = j.location?.name?.trim() || null;
    // first_published is the true publish date; updated_at is NOT posted_at.
    const postedRaw = j.first_published ?? j.updated_at ?? null;
    const postedAt = postedRaw ? new Date(postedRaw) : null;
    const title = (j.title ?? "").trim();

    return {
      source: "greenhouse",
      externalId: String(j.id),
      companyId: target.companyId,
      companyName: j.company_name?.trim() || target.companyName,
      title,
      descriptionMd,
      locationRaw,
      remoteType: inferRemoteType(locationRaw),
      employmentType: "unknown", // GH board API doesn't expose this reliably
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
      applyUrl: j.absolute_url,
      contentHash: sha256(`${title}\n${descriptionMd}`),
    };
  },
};
