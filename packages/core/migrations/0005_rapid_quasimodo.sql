CREATE TABLE "job_research" (
	"job_id" uuid PRIMARY KEY NOT NULL,
	"dossier" jsonb,
	"contacts" jsonb,
	"summary" text,
	"model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job_research" ADD CONSTRAINT "job_research_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;