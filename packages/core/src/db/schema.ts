import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * pgvector halfvec(N) — smaller vectors, faster index scans (design doc §8).
 * NOTE: drizzle-kit generate quotes unknown custom types as `"halfvec(512)"`, which
 * is invalid DDL. After `pnpm db:generate`, unquote it in the new migration:
 *   sed -i '' 's/"halfvec(512)"/halfvec(512)/g' packages/core/migrations/<file>.sql
 * (embeddings are unused until P2, so this only matters when you regenerate.)
 */
const halfvec = customType<{ data: number[]; config: { dim: number }; driverData: string }>({
  dataType(config) {
    return `halfvec(${config?.dim ?? 512})`;
  },
  toDriver(value) {
    return `[${value.join(",")}]`;
  },
  fromDriver(value) {
    return JSON.parse(value) as number[];
  },
});

export const atsProviderEnum = pgEnum("ats_provider", [
  "greenhouse",
  "lever",
  "ashby",
  "workday",
  "smartrecruiters",
  "recruitee",
  "workable",
  "oracle",
  // non-ATS sources (HN "Who's hiring", email alerts): crawl skips these
  // (no adapter); they hold ingested job rows keyed by company name.
  "external",
]);

export const companyStatusEnum = pgEnum("company_status", ["active", "stale", "dead"]);
export const companyTierEnum = pgEnum("company_tier", ["hot", "normal", "long_tail"]);
export const remoteTypeEnum = pgEnum("remote_type", ["remote", "hybrid", "onsite", "unknown"]);
export const employmentTypeEnum = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "contract",
  "internship",
  "temporary",
  "other",
  "unknown",
]);
export const scoreStageEnum = pgEnum("score_stage", ["s0", "s1", "s2"]);
export const feedbackLabelEnum = pgEnum("feedback_label", ["up", "down"]);
export const applicationStatusEnum = pgEnum("application_status", [
  "new",
  "shortlist",
  "applied",
  "screen",
  "interview",
  "offer",
  "rejected",
]);

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    domain: text("domain"),
    atsProvider: atsProviderEnum("ats_provider").notNull(),
    boardToken: text("board_token"),
    workdayTenant: text("workday_tenant"),
    workdaySite: text("workday_site"),
    tier: companyTierEnum("tier").notNull().default("normal"),
    status: companyStatusEnum("status").notNull().default("active"),
    discoveredVia: text("discovered_via"),
    lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
    consecutiveFailures: integer("consecutive_failures").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("companies_provider_token_uq").on(t.atsProvider, t.boardToken),
    // Workday has no board_token; dedupe by tenant host + site instead.
    uniqueIndex("companies_workday_uq").on(t.workdayTenant, t.workdaySite),
    index("companies_status_idx").on(t.status),
  ],
);

export const rawPostings = pgTable(
  "raw_postings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    payload: jsonb("payload").notNull(),
    contentHash: text("content_hash").notNull(),
  },
  (t) => [
    // append-on-change: one row per (posting, distinct payload)
    uniqueIndex("raw_source_ext_hash_uq").on(t.source, t.externalId, t.contentHash),
    index("raw_company_idx").on(t.companyId),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    externalId: text("external_id").notNull(),
    title: text("title").notNull(),
    descriptionMd: text("description_md").notNull().default(""),
    locationRaw: text("location_raw"),
    remoteType: remoteTypeEnum("remote_type").notNull().default("unknown"),
    employmentType: employmentTypeEnum("employment_type").notNull().default("unknown"),
    salaryMin: integer("salary_min"),
    salaryMax: integer("salary_max"),
    salaryCurrency: text("salary_currency"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    consecutiveMisses: integer("consecutive_misses").notNull().default(0),
    applyUrl: text("apply_url").notNull().default(""),
    canonicalJobId: uuid("canonical_job_id"),
    contentHash: text("content_hash").notNull(),
  },
  (t) => [
    uniqueIndex("jobs_source_ext_uq").on(t.source, t.externalId),
    index("jobs_company_idx").on(t.companyId),
    index("jobs_posted_idx").on(t.postedAt),
    index("jobs_closed_idx").on(t.closedAt),
    index("jobs_canonical_idx").on(t.canonicalJobId),
  ],
);

export const jobEnrichment = pgTable("job_enrichment", {
  jobId: uuid("job_id")
    .primaryKey()
    .references(() => jobs.id, { onDelete: "cascade" }),
  seniority: text("seniority"),
  stack: text("stack").array(),
  domainTags: text("domain_tags").array(),
  timezoneRequirement: text("timezone_requirement"),
  workAuthRequirement: text("work_auth_requirement"),
  compParsed: jsonb("comp_parsed"),
  /** distilled ~150-token canonical summary that gets embedded (design doc §7) */
  summary: text("summary"),
  embedding: halfvec("embedding", { dim: 512 }),
  model: text("model"),
  enrichedAt: timestamp("enriched_at", { withTimezone: true }).notNull().defaultNow(),
});

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    label: text("label").notNull(),
    resumeMd: text("resume_md").notNull().default(""),
    mustHave: jsonb("must_have"),
    exclude: jsonb("exclude"),
    embedding: halfvec("embedding", { dim: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("profiles_label_uq").on(t.label)],
);

export const jobScores = pgTable(
  "job_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    profileId: uuid("profile_id")
      .notNull()
      .references(() => profiles.id, { onDelete: "cascade" }),
    stage: scoreStageEnum("stage").notNull(),
    score: integer("score"),
    rubric: jsonb("rubric"),
    model: text("model"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("scores_job_profile_idx").on(t.jobId, t.profileId),
    uniqueIndex("scores_job_profile_stage_uq").on(t.jobId, t.profileId, t.stage),
  ],
);

export const feedback = pgTable("feedback", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  label: feedbackLabelEnum("label").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    status: applicationStatusEnum("status").notNull().default("new"),
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    resumeVersion: text("resume_version"),
    coverLetterPath: text("cover_letter_path"),
    contact: text("contact"),
    notes: text("notes"),
    nextActionAt: timestamp("next_action_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("applications_job_uq").on(t.jobId)], // one application per job
);

export const CREATE_VECTOR_EXTENSION = sql`CREATE EXTENSION IF NOT EXISTS vector`;
