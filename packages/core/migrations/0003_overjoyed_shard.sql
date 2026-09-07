ALTER TYPE "public"."ats_provider" ADD VALUE 'external';--> statement-breakpoint
CREATE UNIQUE INDEX "companies_workday_uq" ON "companies" USING btree ("workday_tenant","workday_site");