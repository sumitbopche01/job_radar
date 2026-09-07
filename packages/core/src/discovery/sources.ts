import { fetchJson } from "../util/http.js";
import type { DiscoverEntry } from "./discover.js";

interface YcCompany {
  name?: string;
  website?: string;
  status?: string;
}

const YC_ALL = "https://yc-oss.github.io/api/companies/all.json";

function domainOf(website: string): string | null {
  const d = website
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .trim()
    .toLowerCase();
  return d && d.includes(".") ? d : null;
}

/**
 * Seed source #1 (design §3): the YC company directory (~6k companies, public).
 * Returns {name, domain} entries with a resolvable domain, deduped. The list is
 * oldest-first (W2012 → present); `recent` sweeps newest-first, where hit rates are
 * far higher (active companies on modern ATSes).
 */
export async function fetchYcDomains(
  opts: { limit?: number; recent?: boolean } = {},
): Promise<DiscoverEntry[]> {
  const all = await fetchJson<YcCompany[]>(YC_ALL, { timeoutMs: 30_000 });
  const ordered = opts.recent ? [...all].reverse() : all;
  const seen = new Set<string>();
  const out: DiscoverEntry[] = [];
  for (const c of ordered) {
    if (!c.website) continue;
    const domain = domainOf(c.website);
    if (!domain || seen.has(domain)) continue;
    seen.add(domain);
    out.push({ name: c.name, domain });
    if (opts.limit && out.length >= opts.limit) break;
  }
  return out;
}
