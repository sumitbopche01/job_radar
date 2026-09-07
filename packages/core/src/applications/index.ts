import { desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { applications, companies, jobs } from "../db/schema.js";

export type ApplicationStatus =
  | "new"
  | "shortlist"
  | "applied"
  | "screen"
  | "interview"
  | "offer"
  | "rejected";

export const APPLICATION_STATUSES: ApplicationStatus[] = [
  "new",
  "shortlist",
  "applied",
  "screen",
  "interview",
  "offer",
  "rejected",
];

export interface ApplicationRow {
  id: string;
  jobId: string;
  status: ApplicationStatus;
  title: string;
  companyName: string;
  locationRaw: string | null;
  applyUrl: string;
  appliedAt: Date | null;
  nextActionAt: Date | null;
  notes: string | null;
  updatedAt: Date;
}

export async function getApplications(db: Db): Promise<ApplicationRow[]> {
  return db
    .select({
      id: applications.id,
      jobId: applications.jobId,
      status: applications.status,
      title: jobs.title,
      companyName: companies.name,
      locationRaw: jobs.locationRaw,
      applyUrl: jobs.applyUrl,
      appliedAt: applications.appliedAt,
      nextActionAt: applications.nextActionAt,
      notes: applications.notes,
      updatedAt: applications.updatedAt,
    })
    .from(applications)
    .innerJoin(jobs, eq(applications.jobId, jobs.id))
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .orderBy(desc(applications.updatedAt)) as Promise<ApplicationRow[]>;
}

export async function setApplicationStatus(
  db: Db,
  jobId: string,
  status: ApplicationStatus,
): Promise<void> {
  await db
    .update(applications)
    .set({
      status,
      updatedAt: new Date(),
      ...(status === "applied" ? { appliedAt: new Date() } : {}),
    })
    .where(eq(applications.jobId, jobId));
}

export async function setNextAction(db: Db, jobId: string, at: Date | null): Promise<void> {
  await db
    .update(applications)
    .set({ nextActionAt: at, updatedAt: new Date() })
    .where(eq(applications.jobId, jobId));
}

export async function setNotes(db: Db, jobId: string, notes: string): Promise<void> {
  await db
    .update(applications)
    .set({ notes, updatedAt: new Date() })
    .where(eq(applications.jobId, jobId));
}

/** Generate applications.csv for the job-search skill (design doc §10). */
export async function exportApplicationsCsv(db: Db): Promise<string> {
  const rows = await getApplications(db);
  const header = [
    "company",
    "title",
    "status",
    "location",
    "applied_at",
    "next_action_at",
    "apply_url",
    "notes",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.companyName,
        r.title,
        r.status,
        r.locationRaw ?? "",
        r.appliedAt ? r.appliedAt.toISOString().slice(0, 10) : "",
        r.nextActionAt ? r.nextActionAt.toISOString().slice(0, 10) : "",
        r.applyUrl,
        r.notes ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n") + "\n";
}

function csvCell(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
