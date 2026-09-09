import type { CanonicalJob, RawPosting, SourceAdapter } from "../types.js";
import { fetchJson } from "../util/http.js";
import { htmlToMarkdown } from "../util/html.js";
import { sha256 } from "../util/hash.js";
import { inferRemoteType, normalizeEmploymentType } from "../util/infer.js";

interface OracleReq {
  Id: string;
  Title: string;
  PostedDate?: string;
  PrimaryLocation?: string;
  PrimaryLocationCountry?: string;
  WorkplaceType?: string; // display string, e.g. "Remote"
  WorkplaceTypeCode?: string; // e.g. "ORA_REMOTE"
  JobType?: string;
  JobSchedule?: string;
  ShortDescriptionStr?: string;
  ExternalResponsibilitiesStr?: string;
  ExternalQualificationsStr?: string;
}

interface OracleResponse {
  items?: { TotalJobsCount?: number; requisitionList?: OracleReq[] }[];
}

const LIMIT = 200;
const MAX_PAGES = 25;

/**
 * Oracle Recruiting Cloud (ORC) public candidate API — common across Gulf/enterprise.
 * companies.workday_tenant holds the host (e.g. "iaambv.fa.ocs.oraclecloud.com");
 * companies.workday_site holds "siteNumber|siteName" (e.g. "CX_1|Presight-Careers")
 * — siteNumber drives the API, siteName the apply URL.
 */
export const oracleAdapter: SourceAdapter = {
  id: "oracle",
  provider: "oracle",
  rateLimit: { concurrency: 10, minDelayMs: 100 },

  async fetch(target) {
    const host = target.workdayTenant;
    const [siteNumber, siteName] = (target.workdaySite ?? "").split("|");
    if (!host || !siteNumber) return [];

    const raws: RawPosting[] = [];
    let total = Infinity;
    for (let page = 0; page < MAX_PAGES && page * LIMIT < total; page++) {
      const finder =
        `findReqs;siteNumber=${siteNumber},facetsList=LOCATIONS;WORK_LOCATIONS;TITLES;CATEGORIES;POSTING_DATES,` +
        `limit=${LIMIT},offset=${page * LIMIT},sortBy=POSTING_DATES_DESC`;
      const url =
        `https://${host}/hcmRestApi/resources/latest/recruitingCEJobRequisitions` +
        `?onlyData=true&expand=requisitionList.secondaryLocations,flexFieldsFacet.values&finder=${finder}`;
      const data = await fetchJson<OracleResponse>(url);
      const item = data?.items?.[0];
      if (page === 0) total = item?.TotalJobsCount ?? 0;
      const reqs = Array.isArray(item?.requisitionList) ? item!.requisitionList! : [];
      if (reqs.length === 0) break;
      for (const r of reqs) {
        raws.push({ source: "oracle", externalId: String(r.Id), companyId: target.companyId, payload: r });
      }
    }
    return raws;
  },

  normalize(raw: RawPosting, target): CanonicalJob {
    const r = raw.payload as OracleReq;
    const host = target.workdayTenant ?? "";
    const siteName = (target.workdaySite ?? "").split("|")[1] ?? "";
    const body = [r.ShortDescriptionStr, r.ExternalResponsibilitiesStr, r.ExternalQualificationsStr]
      .filter(Boolean)
      .join("\n");
    const descriptionMd = htmlToMarkdown(body);
    const locationRaw = r.PrimaryLocation?.trim() || r.PrimaryLocationCountry?.trim() || null;
    const postedAt = r.PostedDate ? new Date(r.PostedDate) : null;
    const title = (r.Title ?? "").trim();
    const workplace = (r.WorkplaceType || r.WorkplaceTypeCode || "").toLowerCase();

    return {
      source: "oracle",
      externalId: String(r.Id),
      companyId: target.companyId,
      companyName: target.companyName,
      title,
      descriptionMd,
      locationRaw,
      remoteType: inferRemoteType(locationRaw, workplace),
      employmentType: normalizeEmploymentType(r.JobSchedule || r.JobType),
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      postedAt: postedAt && !Number.isNaN(postedAt.getTime()) ? postedAt : null,
      applyUrl: `https://${host}/hcmUI/CandidateExperience/en/sites/${siteName}/job/${r.Id}`,
      contentHash: sha256(`${title}\n${descriptionMd}`),
    };
  },
};
