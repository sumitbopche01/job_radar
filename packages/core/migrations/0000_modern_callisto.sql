CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TYPE "public"."application_status" AS ENUM('new', 'shortlist', 'applied', 'screen', 'interview', 'offer', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."ats_provider" AS ENUM('greenhouse', 'lever', 'ashby', 'workday', 'smartrecruiters', 'recruitee', 'workable');--> statement-breakpoint
CREATE TYPE "public"."company_status" AS ENUM('active', 'stale', 'dead');--> statement-breakpoint
CREATE TYPE "public"."company_tier" AS ENUM('hot', 'normal', 'long_tail');--> statement-breakpoint
CREATE TYPE "public"."employment_type" AS ENUM('full_time', 'part_time', 'contract', 'internship', 'temporary', 'other', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."feedback_label" AS ENUM('up', 'down');--> statement-breakpoint
CREATE TYPE "public"."remote_type" AS ENUM('remote', 'hybrid', 'onsite', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."score_stage" AS ENUM('s0', 's1', 's2');--> statement-breakpoint
CREATE TABLE "applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"status" "application_status" DEFAULT 'new' NOT NULL,
	"applied_at" timestamp with time zone,
	"resume_version" text,
	"cover_letter_path" text,
	"contact" text,
	"notes" text,
	"next_action_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"ats_provider" "ats_provider" NOT NULL,
	"board_token" text,
	"workday_tenant" text,
	"workday_site" text,
	"tier" "company_tier" DEFAULT 'normal' NOT NULL,
	"status" "company_status" DEFAULT 'active' NOT NULL,
	"discovered_via" text,
	"last_ok_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"label" "feedback_label" NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_enrichment" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"seniority" text,
	"stack" text[],
	"domain_tags" text[],
	"timezone_requirement" text,
	"work_auth_requirement" text,
	"comp_parsed" jsonb,
	"embedding" halfvec(512),
	"model" text,
	"enriched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"stage" "score_stage" NOT NULL,
	"score" integer,
	"rubric" jsonb,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"description_md" text DEFAULT '' NOT NULL,
	"location_raw" text,
	"remote_type" "remote_type" DEFAULT 'unknown' NOT NULL,
	"employment_type" "employment_type" DEFAULT 'unknown' NOT NULL,
	"salary_min" integer,
	"salary_max" integer,
	"salary_currency" text,
	"posted_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"consecutive_misses" integer DEFAULT 0 NOT NULL,
	"apply_url" text DEFAULT '' NOT NULL,
	"canonical_job_id" uuid,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"resume_md" text DEFAULT '' NOT NULL,
	"must_have" jsonb,
	"exclude" jsonb,
	"embedding" halfvec(512),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_postings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"company_id" uuid NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"payload" jsonb NOT NULL,
	"content_hash" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "applications" ADD CONSTRAINT "applications_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_enrichment" ADD CONSTRAINT "job_enrichment_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_scores" ADD CONSTRAINT "job_scores_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_scores" ADD CONSTRAINT "job_scores_profile_id_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_postings" ADD CONSTRAINT "raw_postings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "companies_provider_token_uq" ON "companies" USING btree ("ats_provider","board_token");--> statement-breakpoint
CREATE INDEX "companies_status_idx" ON "companies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scores_job_profile_idx" ON "job_scores" USING btree ("job_id","profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_source_ext_uq" ON "jobs" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "jobs_company_idx" ON "jobs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "jobs_posted_idx" ON "jobs" USING btree ("posted_at");--> statement-breakpoint
CREATE INDEX "jobs_closed_idx" ON "jobs" USING btree ("closed_at");--> statement-breakpoint
CREATE INDEX "jobs_canonical_idx" ON "jobs" USING btree ("canonical_job_id");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_source_ext_hash_uq" ON "raw_postings" USING btree ("source","external_id","content_hash");--> statement-breakpoint
CREATE INDEX "raw_company_idx" ON "raw_postings" USING btree ("company_id");