import type { CanonicalJob, RawPosting, SourceAdapter } from "../types.js";
import { fetchJson } from "../util/http.js";
import { htmlToMarkdown } from "../util/html.js";
import { sha256 } from "../util/hash.js";
import { inferRemoteType, normalizeEmploymentType } from "../util/infer.js";

interface AshbyCompComponent {
  compensationType?: string; // "Salary", "EquityPercentage", ...
  minValue?: number | null;
  maxValue?: number | null;
  currencyCode?: string | null;
}

interface AshbyJob {
  id: string;
  title: string;
  department?: string;
  team?: string;
  employmentType?: string;
  location?: string;
  publishedAt?: string;
  isListed?: boolean;
  isRemote?: boolean;
  workplaceType?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionHtml?: string;
  compensation?: {
    summaryComponents?: AshbyCompComponent[];
  };
}

interface AshbyResponse {
  jobs: AshbyJob[];
}

function parseSalary(job: AshbyJob): {
  min: number | null;
  max: number | null;
  currency: string | null;
} {
  const comps = job.compensation?.summaryComponents ?? [];
  const salary = comps.find((c) => (c.compensationType ?? "").toLowerCase() === "salary");
  if (salary && (salary.minValue != null || salary.maxValue != null)) {
    return {
      min: salary.minValue ?? null,
      max: salary.maxValue ?? null,
      currency: salary.currencyCode ?? null,
    };
  }
  return { min: null, max: null, currency: null };
}

export const ashbyAdapter: SourceAdapter = {
  id: "ashby",
  provider: "ashby",
  // Ashby has tight rate limits — keep concurrency low (design doc §4).
  rateLimit: { concurrency: 5, minDelayMs: 150 },

  async fetch(target) {
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(
      target.boardToken,
    )}?includeCompensation=true`;
    const data = await fetchJson<AshbyResponse>(url);
    const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
    // Only listed jobs are live on the board.
    return jobs
      .filter((j) => j.isListed !== false)
      .map((j) => ({
        source: "ashby",
        externalId: String(j.id),
        companyId: target.companyId,
        payload: j,
      }));
  },

  normalize(raw: RawPosting, target): CanonicalJob {
    const j = raw.payload as AshbyJob;
    const descriptionMd = htmlToMarkdown(j.descriptionHtml ?? "");
    const locationRaw = j.location?.trim() || null;
    const postedAt = j.publishedAt ? new Date(j.publishedAt) : null;
    const salary = parseSalary(j);
    const title = (j.title ?? "").trim();
    const remoteType = j.isRemote ? "remote" : inferRemoteType(locationRaw, j.workplaceType);

    return {
      source: "ashby",
      externalId: String(j.id),
      companyId: target.companyId,
      companyName: target.companyName,
      title,
      descriptionMd,
      locationRaw,
      remoteType,
      employmentType: normalizeEmploymentType(j.employmentType),
      salaryMin: salary.min,
      salaryMax: salary.max,
      salaryCurrency: salary.currency,
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
      applyUrl: j.applyUrl || j.jobUrl || "",
      contentHash: sha256(`${title}\n${descriptionMd}`),
    };
  },
};
