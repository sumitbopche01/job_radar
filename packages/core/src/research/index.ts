import Anthropic from "@anthropic-ai/sdk";
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { applications, companies, jobResearch, jobs } from "../db/schema.js";
import { anthropicClient, MODELS } from "../llm/index.js";

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

const MAX_ROUNDS = 6;

const SYSTEM =
  "You are a job-search research assistant. Given a company and role, use web search to find: " +
  "(1) the likely hiring manager or engineering leaders for this role, with each person's name, " +
  "title, and PUBLIC LinkedIn profile URL if findable; (2) a brief company dossier (funding stage/recency, " +
  "approx headcount/direction, whether they hire in India or Europe, IST/time-zone overlap, 1-2 recent launches). " +
  "Cite a source URL for each contact and each dossier claim. Do NOT invent people or URLs — omit if unsure. " +
  "When done, reply with ONLY a JSON object (no prose, no code fence) of shape: " +
  `{"contacts":[{"name","role","linkedinUrl","source"}],"dossier":{"funding","headcount","hiresInIndia":bool,"hiresInEurope":bool,"istOverlap","recent":[...]},"summary":"2-3 sentences"}.`;

function parseJson(text: string): ResearchResult | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as ResearchResult;
    return { contacts: o.contacts ?? [], dossier: o.dossier ?? {}, summary: o.summary ?? "" };
  } catch {
    return null;
  }
}

async function runAgent(company: string, title: string, location: string | null): Promise<ResearchResult | null> {
  const client = anthropicClient();
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Company: ${company}\nRole: ${title}${location ? `\nLocation: ${location}` : ""}\n\nResearch this and return the JSON.`,
    },
  ];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await client.messages.create({
      model: MODELS.research,
      max_tokens: 2048,
      system: SYSTEM,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
      messages,
    });
    if (res.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: res.content });
      continue;
    }
    // collect any assistant text; if it parses to our JSON we're done
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const parsed = parseJson(text);
    if (parsed) return parsed;
    if (res.stop_reason !== "tool_use") break;
    messages.push({ role: "assistant", content: res.content });
    messages.push({ role: "user", content: "Now return ONLY the JSON object described." });
  }
  return null;
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
      model: MODELS.research,
    })
    .onConflictDoUpdate({
      target: jobResearch.jobId,
      set: {
        dossier: result.dossier as object,
        contacts: result.contacts as object,
        summary: result.summary,
        model: MODELS.research,
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
