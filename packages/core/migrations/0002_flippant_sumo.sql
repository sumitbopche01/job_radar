ALTER TABLE "job_enrichment" ADD COLUMN "summary" text;--> statement-breakpoint
CREATE UNIQUE INDEX "scores_job_profile_stage_uq" ON "job_scores" USING btree ("job_id","profile_id","stage");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_label_uq" ON "profiles" USING btree ("label");