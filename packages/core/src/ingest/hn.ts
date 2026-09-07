import type { Db } from "../db/client.js";
import { fetchJson } from "../util/http.js";
import { decodeEntities, htmlToMarkdown } from "../util/html.js";
import { inferRemoteType } from "../util/infer.js";
import { ingestPostings, type IngestResult, type Posting } from "./index.js";

interface HnHit {
  objectID: string;
  title: string;
  created_at: string;
}
interface HnSearch {
  hits: HnHit[];
}
interface HnComment {
  id: number;
  text?: string | null;
  created_at_i?: number;
  children?: HnComment[];
}
interface HnItem {
  id: number;
  title: string;
  children?: HnComment[];
}

/** Find the newest "Ask HN: Who is hiring? (Month Year)" thread id. */
export async function latestHiringThreadId(): Promise<{ id: string; title: string }> {
  const data = await fetchJson<HnSearch>(
    "https://hn.algolia.com/api/v1/search_by_date?tags=story,author_whoishiring&hitsPerPage=20",
    { timeoutMs: 20_000 },
  );
  const hit = data.hits.find((h) => /who is hiring\?/i.test(h.title));
  if (!hit) throw new Error("could not find a 'Who is hiring?' thread");
  return { id: hit.objectID, title: hit.title };
}

function firstUrl(rawHtml: string): string | null {
  const href = rawHtml.match(/href="([^"]+)"/i);
  if (href) return decodeEntities(href[1]!);
  const bare = decodeEntities(rawHtml).match(/https?:\/\/[^\s"'<)]+/i);
  return bare ? bare[0] : null;
}

/**
 * Parse one HN "Who is hiring" comment. Convention:
 *   Company | Role | Location | Type | Comp | URL ...description
 * Returns null if it isn't a structured posting (no pipe header).
 */
export function parseHnComment(c: HnComment): Posting | null {
  if (!c.text) return null;
  const md = htmlToMarkdown(c.text);
  const header = md.split("\n")[0]!.trim();
  const parts = header.split("|").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null; // not a structured posting

  const company = parts[0]!;
  const title = parts[1]!;
  const location = parts[2] ?? null;
  const url = firstUrl(c.text) ?? `https://news.ycombinator.com/item?id=${c.id}`;
  const headerLc = header.toLowerCase();
  const remoteType = inferRemoteType(location, headerLc.includes("remote") ? "remote" : undefined);

  return {
    company,
    title,
    location,
    remoteType,
    applyUrl: url,
    descriptionMd: md,
    externalId: `hn-${c.id}`,
    postedAt: c.created_at_i ? new Date(c.created_at_i * 1000) : null,
  };
}

export interface HnIngestResult extends IngestResult {
  thread: string;
  comments: number;
  parsed: number;
}

/** Fetch the latest (or given) HN hiring thread, parse postings, ingest them. */
export async function ingestHiringThread(db: Db, threadId?: string): Promise<HnIngestResult> {
  const { id, title } = threadId
    ? { id: threadId, title: `thread ${threadId}` }
    : await latestHiringThreadId();
  const item = await fetchJson<HnItem>(`https://hn.algolia.com/api/v1/items/${id}`, {
    timeoutMs: 30_000,
  });
  const comments = item.children ?? [];
  const postings: Posting[] = [];
  for (const c of comments) {
    const p = parseHnComment(c);
    if (p) postings.push(p);
  }
  const res = await ingestPostings(db, "hn", postings);
  return { ...res, thread: title, comments: comments.length, parsed: postings.length };
}
