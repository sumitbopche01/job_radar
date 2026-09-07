import Anthropic from "@anthropic-ai/sdk";
import type { AtsProvider } from "../types.js";
import { MODELS } from "../llm/index.js";
import { extractLinks, fetchText, probeAts, type DetectResult } from "./detect.js";

/**
 * Agent 1 — ATS resolution (design §16). Runs ONLY on regex misses (~15%). A bounded
 * tool loop: the model fetches careers pages and probes candidate ATS tokens; the loop
 * terminates the moment probe_ats returns >0 jobs — a verifiable fact, not the model's
 * opinion that it's finished. Cheap model, ≤6 tool rounds.
 */

const MAX_ROUNDS = 6;

const TOOLS: Anthropic.Tool[] = [
  {
    name: "fetch_url",
    description: "Fetch a web page and get its text plus candidate careers/ATS links.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "probe_ats",
    description:
      "Verify an ATS board token by hitting its public API and counting jobs. Providers: greenhouse, lever, ashby.",
    input_schema: {
      type: "object",
      properties: {
        provider: { type: "string", enum: ["greenhouse", "lever", "ashby"] },
        token: { type: "string" },
      },
      required: ["provider", "token"],
      additionalProperties: false,
    },
    strict: true,
  },
];

export async function resolveAtsWithAgent(domain: string): Promise<DetectResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set (needed for the resolution agent).");
  }
  const d = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  const client = new Anthropic();

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content:
        `Find the ATS board token for the company at domain "${d}". Its careers page is ` +
        `JavaScript-rendered or uses a custom URL, so a plain regex missed it. Start by ` +
        `fetching https://${d}/careers or https://${d}, follow careers/jobs links, and when ` +
        `you find a Greenhouse/Lever/Ashby token, call probe_ats to verify it. Stop once a ` +
        `probe returns jobs. If you cannot find one in a few steps, say "NOT_FOUND".`,
    },
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const res = await client.messages.create({
      model: MODELS.extract,
      max_tokens: 1024,
      tools: TOOLS,
      messages,
    });
    if (res.stop_reason !== "tool_use") break;

    messages.push({ role: "assistant", content: res.content });
    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      if (block.name === "fetch_url") {
        const { url } = block.input as { url: string };
        const html = await fetchText(url);
        const links = extractLinks(html, d);
        const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 3500);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `LINKS:\n${links.join("\n")}\n\nTEXT:\n${text}`,
        });
      } else if (block.name === "probe_ats") {
        const { provider, token } = block.input as { provider: AtsProvider; token: string };
        const n = await probeAts(provider, token);
        // Verifiable terminal condition: a real board with jobs.
        if (n > 0) return { domain: d, provider, token, jobCount: n, via: "agent" };
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: `jobs=${n} (not a live board; try another token/provider)`,
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
  }

  return { domain: d, via: "none" };
}
