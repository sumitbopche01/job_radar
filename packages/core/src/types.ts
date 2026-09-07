export type AtsProvider =
  | "greenhouse"
  | "lever"
  | "ashby"
  | "workday"
  | "smartrecruiters"
  | "recruitee"
  | "workable";

export type RemoteType = "remote" | "hybrid" | "onsite" | "unknown";

export type EmploymentType =
  | "full_time"
  | "part_time"
  | "contract"
  | "internship"
  | "temporary"
  | "other"
  | "unknown";

/** A company to crawl, resolved from the `companies` table. */
export interface CrawlTarget {
  companyId: string;
  companyName: string;
  provider: AtsProvider;
  boardToken: string;
  workdayTenant?: string | null;
  workdaySite?: string | null;
}

/** Immutable raw record straight from the ATS, before normalization. */
export interface RawPosting {
  /** adapter id, e.g. "greenhouse" */
  source: string;
  /** stable ATS id for this posting */
  externalId: string;
  companyId: string;
  /** the raw JSON object as returned by the ATS */
  payload: unknown;
}

/** Normalized job, the common shape every adapter produces. */
export interface CanonicalJob {
  source: string;
  externalId: string;
  companyId: string;
  companyName: string;
  title: string;
  descriptionMd: string;
  locationRaw: string | null;
  remoteType: RemoteType;
  employmentType: EmploymentType;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  /** real publish date — NOT updated_at. See CLAUDE.md invariants. */
  postedAt: Date | null;
  applyUrl: string;
  /** hash of title+description, for edit detection */
  contentHash: string;
}

/**
 * Every source implements this shape. Adding a source is one file.
 * Adapters MUST NOT touch the database — they only fetch and normalize.
 */
export interface SourceAdapter {
  id: string;
  provider: AtsProvider;
  rateLimit: { concurrency: number; minDelayMs: number };
  fetch(target: CrawlTarget): Promise<RawPosting[]>;
  normalize(raw: RawPosting, target: CrawlTarget): CanonicalJob;
}
