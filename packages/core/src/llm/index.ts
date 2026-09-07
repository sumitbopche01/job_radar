import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import * as z from "zod/v4";
import { fetchJson } from "../util/http.js";

/**
 * The ONE place model strings and provider clients live (design doc §16).
 * Hybrid: OpenAI for embeddings (Anthropic has no embeddings API), Anthropic
 * for extraction and the judge. Read the current price page before tuning.
 */
export const MODELS = {
  embed: process.env.JR_EMBED_MODEL ?? "text-embedding-3-small",
  embedDims: Number(process.env.JR_EMBED_DIMS ?? "512"),
  extract: process.env.JR_MODEL_EXTRACT ?? "claude-haiku-4-5",
  judge: process.env.JR_MODEL_JUDGE ?? "claude-haiku-4-5",
  judgeTop: process.env.JR_MODEL_JUDGE_TOP ?? "claude-sonnet-5",
} as const;

export function hasOpenAI(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
export function hasAnthropic(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

let _anthropic: Anthropic | undefined;
function anthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set (needed for extraction + judge).");
  }
  return (_anthropic ??= new Anthropic());
}

// ---------------------------------------------------------------------------
// Embeddings (OpenAI)
// ---------------------------------------------------------------------------

interface OpenAiEmbedResponse {
  data: { embedding: number[]; index: number }[];
}

/** Embed texts with OpenAI, reduced to MODELS.embedDims. Batched. */
export async function embed(texts: string[]): Promise<number[][]> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set (needed for embeddings).");
  }
  if (texts.length === 0) return [];
  const out: number[][] = [];
  const BATCH = 128;
  for (let i = 0; i < texts.length; i += BATCH) {
    const chunk = texts.slice(i, i + BATCH).map((t) => t.slice(0, 8000) || " ");
    const res = await fetchJson<OpenAiEmbedResponse>("https://api.openai.com/v1/embeddings", {
      method: "POST",
      body: { model: MODELS.embed, input: chunk, dimensions: MODELS.embedDims },
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      timeoutMs: 60_000,
    });
    for (const d of res.data.sort((a, b) => a.index - b.index)) out.push(d.embedding);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Extraction (Anthropic) — JD -> compact struct + distilled summary
// ---------------------------------------------------------------------------

export const ExtractionSchema = z.object({
  seniority: z.enum([
    "intern",
    "junior",
    "mid",
    "senior",
    "staff",
    "principal",
    "lead",
    "manager",
    "director",
    "unknown",
  ]),
  stack: z.array(z.string()).describe("concrete technologies, languages, frameworks named in the JD"),
  domainTags: z.array(z.string()).describe("problem domains, e.g. 'llm-infra', 'payments', 'devtools'"),
  remoteSummary: z.string().describe("one phrase: remote policy + any geo/timezone constraint"),
  timezoneRequirement: z.string().nullable().describe("required timezone overlap, or null"),
  workAuthRequirement: z.string().nullable().describe("work authorization / visa constraints, or null"),
  compMin: z.number().nullable(),
  compMax: z.number().nullable(),
  compCurrency: z.string().nullable(),
  summary: z
    .string()
    .describe(
      "~150-token canonical summary: role, seniority, core stack, domain, scope, remote policy. No boilerplate, no company marketing.",
    ),
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export interface ExtractInput {
  title: string;
  company: string;
  descriptionMd: string;
}

const EXTRACT_SYSTEM =
  "You distill job descriptions into a compact structured record for a matching engine. " +
  "Ignore boilerplate (benefits, EEO, company marketing, 'about us'). " +
  "Extract only what a senior engineer would use to judge fit. Be terse and concrete.";

export async function extractJob(input: ExtractInput): Promise<Extraction> {
  const client = anthropic();
  const res = await client.messages.parse({
    model: MODELS.extract,
    max_tokens: 1024,
    system: EXTRACT_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Company: ${input.company}\nTitle: ${input.title}\n\nJob description:\n${input.descriptionMd.slice(0, 12000)}`,
      },
    ],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });
  if (!res.parsed_output) throw new Error("extraction returned no parsed output");
  return res.parsed_output;
}

// ---------------------------------------------------------------------------
// Judge (Anthropic) — structured fit rubric
// ---------------------------------------------------------------------------

export const RubricSchema = z.object({
  fit_score: z.number().min(0).max(100),
  seniority_match: z.enum(["under", "match", "over"]),
  evidence: z.array(z.string()).describe("specific JD lines matched to specific things the candidate has done"),
  gaps: z.array(z.string()).describe("what's missing, honestly"),
  eligibility_risk: z.enum(["none", "timezone", "work_auth", "onsite"]),
  founder_question_risk: z.string().describe("how they'll read the candidate's background"),
  hook: z.string().describe("one line to open the application with"),
});
export type Rubric = z.infer<typeof RubricSchema>;

export interface JudgeExample {
  summary: string;
  label: "up" | "down";
  reason?: string | null;
}

export interface JudgeInput {
  /** profile the constant, cacheable prefix is built from */
  profileLabel: string;
  profileSummary: string;
  mustHave?: unknown;
  exclude?: unknown;
  fewShot: JudgeExample[];
  /** the job being judged (goes last, after the cache breakpoint) */
  jobSummary: string;
  jobTitle: string;
  jobCompany: string;
  /** true for the top-15 escalation to the stronger model */
  escalate?: boolean;
}

const JUDGE_INSTRUCTIONS =
  "You are a hiring-fit judge for a specific candidate profile. Score how well a job fits THIS profile. " +
  "Be skeptical and specific: cite JD lines as evidence, name real gaps, and flag eligibility risks honestly. " +
  "fit_score is 0-100 where 80+ means 'worth 20 minutes to apply'. Do not inflate.";

function buildJudgeSystem(input: JudgeInput): Anthropic.TextBlockParam[] {
  const fewShot = input.fewShot.length
    ? "\n\nCalibration examples (candidate's own past thumbs):\n" +
      input.fewShot
        .map((e) => `- [${e.label === "up" ? "GOOD FIT" : "BAD FIT"}${e.reason ? ` · ${e.reason}` : ""}] ${e.summary}`)
        .join("\n")
    : "";
  const text =
    `${JUDGE_INSTRUCTIONS}\n\n` +
    `Candidate profile: ${input.profileLabel}\n${input.profileSummary}\n` +
    `Must-have: ${JSON.stringify(input.mustHave ?? {})}\n` +
    `Exclude: ${JSON.stringify(input.exclude ?? {})}` +
    fewShot;
  // The whole profile+rubric+few-shot prefix is constant across the day's jobs -> cache it.
  return [{ type: "text", text, cache_control: { type: "ephemeral" } }];
}

export async function judgeJob(input: JudgeInput): Promise<Rubric> {
  const client = anthropic();
  const res = await client.messages.parse({
    model: input.escalate ? MODELS.judgeTop : MODELS.judge,
    max_tokens: 1024,
    system: buildJudgeSystem(input),
    messages: [
      {
        role: "user",
        content: `Job: ${input.jobTitle} @ ${input.jobCompany}\n\n${input.jobSummary}`,
      },
    ],
    output_config: { format: zodOutputFormat(RubricSchema) },
  });
  if (!res.parsed_output) throw new Error("judge returned no parsed output");
  return res.parsed_output;
}
