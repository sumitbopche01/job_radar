#!/usr/bin/env -S npx tsx
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  createDb,
  dedupe,
  exportApplicationsCsv,
  getStats,
  runCrawl,
  seedCompanies,
  sendDigest,
  type CrawlResult,
  type SeedCompany,
} from "@job-radar/core";
import { runMigrate } from "./migrate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = resolve(__dirname, "../data/companies.seed.json");

interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

function num(v: string | boolean | undefined): number | undefined {
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

async function main() {
  const { _, flags } = parseArgs(process.argv.slice(2));
  const cmd = _[0] ?? "help";

  if (cmd === "help" || flags.help) return printHelp();

  if (cmd === "migrate") {
    await runMigrate();
    console.log("✓ migrations applied");
    return;
  }

  const { db, client } = createDb();
  try {
    switch (cmd) {
      case "seed": {
        const raw = await readFile(SEED_PATH, "utf8");
        const seeds = JSON.parse(raw) as SeedCompany[];
        const res = await seedCompanies(db, seeds);
        console.log(`✓ seed: ${res.inserted} new, ${res.total} companies total`);
        break;
      }
      case "crawl": {
        const started = Date.now();
        const only = typeof flags.only === "string" ? flags.only : undefined;
        const company = typeof flags.company === "string" ? flags.company : undefined;
        const results = await runCrawl(db, {
          only,
          company,
          includeInactive: Boolean(flags["include-inactive"]),
          onResult: (r) => logResult(r),
        });
        summarize(results, Date.now() - started);
        break;
      }
      case "dedupe": {
        const res = await dedupe(db);
        console.log(`✓ dedupe: ${res.duplicatesLinked} duplicates linked across ${res.groups} groups`);
        break;
      }
      case "digest": {
        const res = await sendDigest(db, {
          top: num(flags.top) ?? 10,
          sinceDays: num(flags.since) ?? 7,
          dryRun: Boolean(flags["dry-run"]),
        });
        if (res.sent) console.log(`✓ digest sent to ${res.to} (${res.count} roles) via ${res.channel}`);
        else console.log(`✓ digest rendered (${res.count} roles) — ${res.channel} (set RESEND_API_KEY + DIGEST_TO to email)`);
        break;
      }
      case "export": {
        const csv = await exportApplicationsCsv(db);
        const out = _[1] ?? "applications.csv";
        await writeFile(out, csv, "utf8");
        const rows = csv.trim().split("\n").length - 1;
        console.log(`✓ exported ${rows} applications -> ${out}`);
        break;
      }
      case "stats": {
        const s = await getStats(db);
        console.log("Job Radar stats");
        console.log(`  companies:   ${s.companies} (active ${s.companiesActive}, stale ${s.companiesStale})`);
        console.log(`  jobs open:   ${s.jobsOpen}`);
        console.log(`  duplicates:  ${s.jobsDuplicates}`);
        console.log(`  closed:      ${s.jobsClosed}`);
        console.log(`  new (24h):   ${s.newLast24h}`);
        console.log(`  by source:   ${Object.entries(s.bySource).map(([k, v]) => `${k}=${v}`).join("  ") || "—"}`);
        break;
      }
      default:
        console.error(`unknown command: ${cmd}`);
        printHelp();
        process.exitCode = 1;
    }
  } finally {
    await client.end({ timeout: 5 });
  }
}

function logResult(r: CrawlResult) {
  if (!r.ok) {
    console.log(`  ✗ ${r.company} (${r.source}): ${r.error}`);
    return;
  }
  const parts = [`fetched ${r.fetched}`];
  if (r.inserted) parts.push(`+${r.inserted} new`);
  if (r.contentUpdated) parts.push(`~${r.contentUpdated} changed`);
  if (r.reopened) parts.push(`↺${r.reopened} reopened`);
  if (r.closed) parts.push(`-${r.closed} closed`);
  console.log(`  ✓ ${r.company} (${r.source}): ${parts.join(", ")}`);
}

function summarize(results: CrawlResult[], ms: number) {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const sum = (f: (r: CrawlResult) => number) => ok.reduce((a, r) => a + f(r), 0);
  console.log("");
  console.log(
    `Crawl done in ${(ms / 1000).toFixed(1)}s — ${ok.length} ok, ${failed.length} failed`,
  );
  console.log(
    `  fetched ${sum((r) => r.fetched)} · new ${sum((r) => r.inserted)} · changed ${sum(
      (r) => r.contentUpdated,
    )} · reopened ${sum((r) => r.reopened)} · closed ${sum((r) => r.closed)}`,
  );
  if (failed.length) {
    console.log(`  failures: ${failed.map((f) => f.company).join(", ")}`);
  }
}

function printHelp() {
  console.log(`jr — Job Radar CLI

Usage:
  pnpm jr migrate                 apply DB migrations (creates pgvector ext)
  pnpm jr seed                    upsert seed companies (data/companies.seed.json)
  pnpm jr crawl                   crawl all active companies
  pnpm jr crawl --only ashby      crawl one ATS provider
  pnpm jr crawl --company stripe  crawl one company (by board token)
  pnpm jr dedupe                  link cross-source duplicates
  pnpm jr digest [--dry-run]      build + send the daily digest
  pnpm jr digest --top 15 --since 3
  pnpm jr export [path]           write applications.csv for the job-search skill
  pnpm jr stats                   show pipeline counts
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
