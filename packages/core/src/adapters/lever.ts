import type { CanonicalJob, RawPosting, SourceAdapter } from "../types.js";
import { fetchJson } from "../util/http.js";
import { htmlToMarkdown } from "../util/html.js";
import { sha256 } from "../util/hash.js";
import { inferRemoteType, normalizeEmploymentType } from "../util/infer.js";

interface LeverJob {
  id: string;
  text: string; // title
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number; // epoch ms
  description?: string; // HTML
  descriptionPlain?: string;
  additional?: string; // HTML
  workplaceType?: string;
  categories?: {
    location?: string;
    team?: string;
    department?: string;
    commitment?: string;
  };
  salaryRange?: {
    min?: number;
    max?: number;
    currency?: string;
  };
}

export const leverAdapter: SourceAdapter = {
  id: "lever",
  provider: "lever",
  rateLimit: { concurrency: 30, minDelayMs: 50 },

  async fetch(target) {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(
      target.boardToken,
    )}?mode=json`;
    const data = await fetchJson<LeverJob[]>(url);
    const jobs = Array.isArray(data) ? data : [];
    return jobs.map((j) => ({
      source: "lever",
      externalId: String(j.id),
      companyId: target.companyId,
      payload: j,
    }));
  },

  normalize(raw: RawPosting, target): CanonicalJob {
    const j = raw.payload as LeverJob;
    const body = [j.description ?? "", j.additional ?? ""].filter(Boolean).join("\n");
    const descriptionMd = htmlToMarkdown(body);
    const locationRaw = j.categories?.location?.trim() || null;
    const postedAt = typeof j.createdAt === "number" ? new Date(j.createdAt) : null;
    const title = (j.text ?? "").trim();

    return {
      source: "lever",
      externalId: String(j.id),
      companyId: target.companyId,
      companyName: target.companyName,
      title,
      descriptionMd,
      locationRaw,
      remoteType: inferRemoteType(locationRaw, j.workplaceType),
      employmentType: normalizeEmploymentType(j.categories?.commitment),
      salaryMin: j.salaryRange?.min ?? null,
      salaryMax: j.salaryRange?.max ?? null,
      salaryCurrency: j.salaryRange?.currency ?? null,
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
      applyUrl: j.applyUrl || j.hostedUrl || "",
      contentHash: sha256(`${title}\n${descriptionMd}`),
    };
  },
};
