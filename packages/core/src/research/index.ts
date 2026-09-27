import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { applications, companies, jobResearch, jobs } from "../db/schema.js";
import { MODELS, webSearch } from "../llm/index.js";

/**
 * Agent 2 — company research on shortlist (design §16). Uses Anthropic web search
 * to find the likely hiring manager / eng leaders (name + public LinkedIn URL) and
 * a short company dossier — each claim sourced. We never scrape LinkedIn; the model
 * reads public web pages. Bounded loop; returns structured JSON.
 */

export interface Contact {
  name: string;
  role: string;
  linkedinUrl?: string;
  source?: string;
}
export interface Dossier {
  funding?: string;
  headcount?: string;
  hiresInIndia?: boolean;
  hiresInEurope?: boolean;
  istOverlap?: string;
  recent?: string[];
}
export interface ResearchResult {
  contacts: Contact[];
  dossier: Dossier;
  summary: string;
}

const PROMPT = (company: string, title: string, location: string | null) =>
  `You are a job-search research assistant. Use web search to research the company "${company}" ` +
  `hiring for the role "${title}"${location ? ` (${location})` : ""}.\n\n` +
  `Find:\n` +
  `1) Up to 5 REAL, NAMED people worth reaching out to for this role — e.g. the engineering manager/leaders ` +
  `(Head of Engineering, VP Eng, CTO, Director of Engineering), a relevant team member, or a named recruiter. ` +
  `Search for actual individuals (their real full name) currently at this company. For each, give: full name, ` +
  `their title, and a PUBLIC profile URL (their real LinkedIn /in/ URL if you find it, otherwise the page you ` +
  `found them on) plus a source URL.\n` +
  `   IMPORTANT: only include a person if you actually found their real name. Do NOT output placeholders like ` +
  `"Not found", "Unknown", or empty names. If you truly cannot find any named person, return "contacts": [].\n` +
  `2) A brief company dossier: funding stage/recency, approx headcount and direction, whether they hire in ` +
  `India or Europe, time-zone overlap with IST, and 1-2 recent launches/news. Cite a source URL per claim.\n\n` +
  `Reply with ONLY a JSON object (no prose, no markdown fence):\n` +
  `{"contacts":[{"name":"Full Name","role":"Title","linkedinUrl":"https://...","source":"https://..."}],` +
  `"dossier":{"funding":"","headcount":"","hiresInIndia":true,"hiresInEurope":true,"istOverlap":"","recent":[]},` +
  `"summary":"2-3 sentence outreach-oriented summary"}`;

function parseJson(text: string): ResearchResult | null {
  // strip code fences if present, then grab the outermost JSON object
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "");
  const m = cleaned.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as ResearchResult;
    const contacts = (Array.isArray(o.contacts) ? o.contacts : []).filter(
      (c) => c && c.name && !/not\s*found|unknown|^n\/?a$|placeholder|^-$/i.test(c.name.trim()),
    );
    return { contacts, dossier: o.dossier ?? {}, summary: o.summary ?? "" };
  } catch {
    return null;
  }
}

async function runAgent(company: string, title: string, location: string | null): Promise<ResearchResult | null> {
  const text = await webSearch(PROMPT(company, title, location));
  return parseJson(text);
}

/** Research one job and store the dossier + contacts. */
export async function researchJob(db: Db, jobId: string): Promise<ResearchResult | null> {
  const [row] = await db
    .select({ title: jobs.title, company: companies.name, location: jobs.locationRaw })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(eq(jobs.id, jobId));
  if (!row) throw new Error(`job ${jobId} not found`);

  const result = await runAgent(row.company, row.title, row.location);
  if (!result) return null;

  await db
    .insert(jobResearch)
    .values({
      jobId,
      dossier: result.dossier as object,
      contacts: result.contacts as object,
      summary: result.summary,
      model: MODELS.researchOpenAI,
    })
    .onConflictDoUpdate({
      target: jobResearch.jobId,
      set: {
        dossier: result.dossier as object,
        contacts: result.contacts as object,
        summary: result.summary,
        model: MODELS.researchOpenAI,
        createdAt: new Date(),
      },
    });
  return result;
}

/** Research all shortlisted applications that don't have research yet. */
export async function researchShortlisted(
  db: Db,
  opts: { limit?: number; onProgress?: (company: string, ok: boolean) => void } = {},
): Promise<{ done: number; failed: number }> {
  const rows = await db
    .select({ jobId: applications.jobId, company: companies.name })
    .from(applications)
    .innerJoin(jobs, eq(jobs.id, applications.jobId))
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .where(
      and(
        sql`${applications.status} in ('shortlist','applied','screen','interview')`,
        sql`not exists (select 1 from ${jobResearch} r where r.job_id = ${applications.jobId})`,
      ),
    )
    .limit(opts.limit ?? 20);

  let done = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const res = await researchJob(db, r.jobId);
      if (res) done++;
      else failed++;
      opts.onProgress?.(r.company, Boolean(res));
    } catch {
      failed++;
      opts.onProgress?.(r.company, false);
    }
  }
  return { done, failed };
}
