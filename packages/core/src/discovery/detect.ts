import type { AtsProvider } from "../types.js";
import { getAdapter } from "../adapters/index.js";

const UA = "Mozilla/5.0 (compatible; job-radar/0.1; +personal job discovery)";

/** Tokens that are never a real board (regex false positives). */
const RESERVED = new Set([
  "v1",
  "boards",
  "embed",
  "job_board",
  "job-board",
  "posting-api",
  "search",
  "widget",
  "api",
  "www",
  "jobs",
  "careers",
  "static",
  "assets",
  "images",
]);

interface Candidate {
  provider: AtsProvider;
  token: string;
}

// provider -> regexes capturing the board token
const PATTERNS: { provider: AtsProvider; res: RegExp[] }[] = [
  {
    provider: "greenhouse",
    res: [
      /(?:boards|job-boards|boards-api)\.greenhouse\.io\/(?:v1\/boards\/)?([a-zA-Z0-9_-]+)/g,
      /greenhouse\.io\/embed\/job_board[^"'<> ]*?[?&]for=([a-zA-Z0-9_-]+)/g,
    ],
  },
  {
    provider: "lever",
    res: [
      /jobs\.lever\.co\/([a-zA-Z0-9_-]+)/g,
      /api\.lever\.co\/v0\/postings\/([a-zA-Z0-9_-]+)/g,
    ],
  },
  {
    provider: "ashby",
    res: [
      /jobs\.ashbyhq\.com\/([a-zA-Z0-9_-]+)/g,
      /api\.ashbyhq\.com\/posting-api\/job-board\/([a-zA-Z0-9_-]+)/g,
      /ashbyhq\.com\/[^"'<> ]*?jobBoardName=([a-zA-Z0-9_-]+)/g,
    ],
  },
];

/** Links from a page that plausibly lead to a careers/ATS page (for the agent). */
export function extractLinks(html: string, baseDomain: string): string[] {
  const links = new Set<string>();
  for (const m of html.matchAll(/href=["']([^"']+)["']/gi)) {
    let href = m[1]!;
    if (/greenhouse\.io|lever\.co|ashbyhq\.com|career|job|hiring|work-with-us|join/i.test(href)) {
      if (href.startsWith("/")) href = `https://${baseDomain}${href}`;
      if (/^https?:\/\//.test(href)) links.add(href);
    }
  }
  return [...links].slice(0, 25);
}

export interface DetectResult {
  domain: string;
  provider?: AtsProvider;
  token?: string;
  jobCount?: number;
  via: "regex" | "agent" | "none";
}

export async function fetchText(url: string, timeoutMs = 6000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // global fetch follows redirects by default (careers pages often 301 to the ATS)
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,*/*" },
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) return "";
    return await res.text();
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export function extractCandidates(html: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const { provider, res } of PATTERNS) {
    for (const re of res) {
      for (const m of html.matchAll(re)) {
        const token = m[1];
        if (!token || RESERVED.has(token.toLowerCase())) continue;
        const key = `${provider}:${token}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ provider, token });
      }
    }
  }
  return out;
}

/** Confirm a candidate token by hitting the ATS endpoint and counting jobs. */
export async function probeAts(provider: AtsProvider, token: string): Promise<number> {
  const adapter = getAdapter(provider);
  if (!adapter) return 0;
  try {
    const raws = await adapter.fetch({
      companyId: "",
      companyName: token,
      provider,
      boardToken: token,
    });
    return raws.length;
  } catch {
    return 0;
  }
}

/**
 * Detect a company's ATS from its domain: fetch likely careers pages, regex the
 * HTML for ATS board links, then VERIFY each candidate by probing the endpoint.
 * Returns the verified board with the most jobs, or {via:"none"} on a regex miss
 * (JS-rendered pages, custom subdomains) — those go to the resolution agent.
 */
export async function detectAts(domain: string): Promise<DetectResult> {
  const d = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  const urls = [`https://${d}/careers`, `https://${d}/jobs`, `https://careers.${d}`, `https://${d}`];

  const htmls = await Promise.all(urls.map((u) => fetchText(u)));
  const html = htmls.join("\n");
  const candidates = extractCandidates(html);

  let best: DetectResult | undefined;
  for (const c of candidates) {
    const n = await probeAts(c.provider, c.token);
    if (n > 0 && (!best || n > (best.jobCount ?? 0))) {
      best = { domain: d, provider: c.provider, token: c.token, jobCount: n, via: "regex" };
    }
  }
  return best ?? { domain: d, via: "none" };
}
