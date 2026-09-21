#!/usr/bin/env -S npx tsx
import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  createDb,
  dedupe,
  detectAts,
  discoverCompanies,
  discoverTokens,
  embedProfiles,
  ensureSearchIndexes,
  enrichJobs,
  fetchYcDomains,
  ingestAlertEmail,
  ingestHiringThread,
  ingestRemoteBoards,
  resolveAtsWithAgent,
  runLiveness,
  upsertDiscovered,
  upsertOracle,
  upsertWorkday,
  type DiscoverEntry,
  exportApplicationsCsv,
  getProfile,
  getStats,
  listProfiles,
  retrieve,
  runCrawl,
  runEval,
  scaffoldEvalSet,
  scoreProfile,
  seedCompanies,
  seedProfiles,
  sendDigest,
  type CrawlResult,
  type EvalItem,
  type ProfileSeed,
  type SeedCompany,
} from "@job-radar/core";
import { runMigrate } from "./migrate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_PATH = resolve(__dirname, "../data/companies.seed.json");
const PROFILES_PATH = resolve(__dirname, "../data/profiles.seed.json");
const TOKENS_PATH = resolve(__dirname, "../data/discovery-tokens.txt");

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
        // Keep the queue/digest correct without a manual second step.
        if (!flags["no-dedupe"]) {
          const dd = await dedupe(db);
          console.log(`  dedupe: ${dd.duplicatesLinked} duplicates linked across ${dd.groups} groups`);
        }
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
      case "discover": {
        const sub = _[1] ?? "yc";
        const limit = num(flags.limit);
        let entries: DiscoverEntry[] = [];
        if (sub === "workday") {
          const host = _[2];
          const site = _[3];
          if (!host || !site)
            throw new Error("usage: jr discover workday <host> <site> [name]  (host e.g. nvidia.wd5.myworkdayjobs.com)");
          await upsertWorkday(db, { host, site, name: _.slice(4).join(" ") || undefined });
          console.log(`✓ added workday company ${host}/${site} — crawl with: jr crawl --only workday`);
          break;
        }
        if (sub === "oracle") {
          const host = _[2];
          const siteNumber = _[3];
          const siteName = _[4];
          if (!host || !siteNumber || !siteName)
            throw new Error("usage: jr discover oracle <host> <siteNumber> <siteName> [name]  (e.g. iaambv.fa.ocs.oraclecloud.com CX_1 Presight-Careers Presight)");
          await upsertOracle(db, { host, siteNumber, siteName, name: _.slice(5).join(" ") || undefined });
          console.log(`✓ added oracle company ${host}/${siteNumber} — crawl with: jr crawl --only oracle`);
          break;
        }
        if (sub === "tokens") {
          const file = _[2] ?? TOKENS_PATH;
          const txt = await readFile(file, "utf8");
          const toks = txt
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("#"))
            .map((l) => {
              const [provider, token, ...rest] = l.split(/[\s,]+/);
              return { provider: provider as never, token: token!, name: rest.join(" ") || undefined };
            })
            .filter((t) => t.provider && t.token);
          console.log(`Verifying ${toks.length} ATS tokens…`);
          const r = await discoverTokens(db, toks, {
            onResult: (e, n) => {
              if (n > 0) console.log(`  ✓ ${e.provider}/${e.token} (${n} jobs)`);
            },
          });
          console.log(`\n✓ tokens: ${r.verified}/${r.processed} verified, ${r.added} new companies, ${r.dead.length} dead`);
          break;
        }
        if (sub === "domain") {
          const dom = _[2];
          if (!dom) throw new Error("usage: jr discover domain <domain>");
          const r = await detectAts(dom);
          console.log(
            r.provider
              ? `✓ ${r.domain} -> ${r.provider}/${r.token} (${r.jobCount} jobs, via ${r.via})`
              : `✗ ${r.domain} -> no ATS found via regex`,
          );
          if (!r.provider && flags.agent) {
            console.log("  trying resolution agent…");
            const a = await resolveAtsWithAgent(dom);
            console.log(
              a.provider ? `  ✓ agent: ${a.provider}/${a.token} (${a.jobCount} jobs)` : "  ✗ agent: not found",
            );
          }
          break;
        }
        if (sub === "yc") {
          const recent = Boolean(flags.recent);
          console.log(`Fetching YC company list${limit ? ` (limit ${limit})` : ""}${recent ? " [recent-first]" : ""}…`);
          entries = await fetchYcDomains({ limit, recent });
        } else if (sub === "domains") {
          const file = _[2];
          if (!file) throw new Error("usage: jr discover domains <file>");
          const txt = await readFile(file, "utf8");
          entries = txt
            .split("\n")
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith("#"))
            .map((domain) => ({ domain }));
        } else {
          throw new Error("usage: jr discover [yc|domains <file>|domain <domain>] [--limit N] [--agent]");
        }

        console.log(`Detecting ATS across ${entries.length} domains…`);
        let done = 0;
        const res = await discoverCompanies(db, entries, {
          discoveredVia: sub === "yc" ? "yc" : "seed-file",
          onResult: (r) => {
            done++;
            if (r.provider) console.log(`  ✓ ${r.domain} -> ${r.provider}/${r.token} (${r.jobCount})`);
            if (done % 100 === 0) process.stdout.write(`  …${done}/${entries.length}\n`);
          },
        });
        console.log(
          `\n✓ discover: ${res.resolved}/${res.processed} resolved, ${res.added} new companies, ${res.misses} regex misses`,
        );

        if (flags.agent && res.missDomains.length) {
          const cap = num(flags["agent-limit"]) ?? 25;
          const targets = res.missDomains.slice(0, cap);
          console.log(`Running resolution agent on ${targets.length} misses…`);
          let recovered = 0;
          for (const dom of targets) {
            try {
              const a = await resolveAtsWithAgent(dom);
              if (a.provider && a.token) {
                recovered++;
                await upsertDiscovered(db, { domain: dom, provider: a.provider, token: a.token, via: "agent" });
                console.log(`  ✓ ${dom} -> ${a.provider}/${a.token} (${a.jobCount})`);
              }
            } catch (e) {
              console.log(`  agent error on ${dom}: ${e instanceof Error ? e.message : e}`);
              break;
            }
          }
          console.log(`✓ agent recovered ${recovered}/${targets.length}`);
        }
        break;
      }
      case "liveness": {
        const r = await runLiveness(db);
        console.log("Liveness");
        console.log(`  companies:    ${r.total}`);
        console.log(`  active:       ${r.active}  (never crawled: ${r.neverCrawled})`);
        console.log(`  stale:        ${r.stale}  (+${r.markedStale} this run)`);
        console.log(`  dead:         ${r.dead}  (+${r.markedDead} this run)`);
        console.log(`  failing:      ${r.failingPct.toFixed(1)}%  (P3 target < 2%)`);
        break;
      }
      case "ingest": {
        const sub = _[1] ?? "hn";
        if (sub === "hn") {
          const r = await ingestHiringThread(db, typeof flags.thread === "string" ? flags.thread : undefined);
          console.log(`✓ ingest hn "${r.thread}": ${r.comments} comments, ${r.parsed} parsed`);
          console.log(`  ${r.inserted} new, ${r.updated} updated, ${r.companies} companies, ${r.skipped} skipped`);
        } else if (sub === "email") {
          const file = _[2];
          if (!file) throw new Error("usage: jr ingest email <file.html> [provider]");
          const html = await readFile(file, "utf8");
          const provider = _[3] as never;
          const r = await ingestAlertEmail(db, html, provider);
          console.log(`✓ ingest email (${r.provider}): ${r.parsed} parsed, ${r.inserted} new, ${r.updated} updated, ${r.skipped} skipped`);
        } else if (sub === "remote") {
          const r = await ingestRemoteBoards(db);
          for (const [name, b] of Object.entries(r.boards)) {
            const err = (b as { error?: string }).error;
            console.log(
              err
                ? `  ✗ ${name}: ${err}`
                : `  ✓ ${name}: ${b.fetched} fetched, ${b.inserted} new, ${b.updated} updated, ${b.companies} companies`,
            );
          }
        } else {
          throw new Error("usage: jr ingest [hn|email <file>|remote]");
        }
        break;
      }
      case "enrich": {
        const res = await enrichJobs(db, {
          limit: num(flags.limit) ?? 200,
          sinceDays: num(flags.since) ?? 30,
          onProgress: (d, t) => process.stdout.write(`\r  extracting ${d}/${t}`),
        });
        process.stdout.write("\n");
        console.log(`✓ enrich: ${res.enriched} enriched, ${res.failed} failed`);
        break;
      }
      case "profiles": {
        const sub = _[1] ?? "list";
        if (sub === "seed") {
          const seeds = JSON.parse(await readFile(PROFILES_PATH, "utf8")) as ProfileSeed[];
          const n = await seedProfiles(db, seeds);
          console.log(`✓ profiles: ${n} upserted`);
        } else if (sub === "embed") {
          const n = await embedProfiles(db, Boolean(flags.force));
          console.log(`✓ profiles: ${n} embedded`);
        } else {
          const rows = await listProfiles(db);
          for (const p of rows) {
            console.log(`  ${p.label}${p.embedding ? " (embedded)" : " (no embedding)"}`);
          }
        }
        break;
      }
      case "retrieve": {
        const label = _[1] ?? (typeof flags.profile === "string" ? flags.profile : undefined);
        if (!label) throw new Error("usage: jr retrieve <profile>");
        await ensureSearchIndexes(db);
        const profile = await getProfile(db, label);
        if (!profile) throw new Error(`no profile "${label}" — run: jr profiles seed`);
        const results = await retrieve(db, profile, { limit: num(flags.limit) ?? 20 });
        console.log(`Top ${results.length} for ${label} (fts+vector RRF):`);
        results.forEach((r, i) =>
          console.log(
            `  ${String(i + 1).padStart(2)}. ${r.title} — ${r.companyName}  [fts:${r.ftsRank ?? "-"} vec:${r.vecRank ?? "-"} rrf:${r.rrf.toFixed(4)}]`,
          ),
        );
        break;
      }
      case "score": {
        const label = _[1] ?? (typeof flags.profile === "string" ? flags.profile : undefined);
        if (!label) throw new Error("usage: jr score <profile>");
        const res = await scoreProfile(db, label, {
          limit: num(flags.limit) ?? 60,
          top: num(flags.top) ?? 15,
          onProgress: (d, t) => process.stdout.write(`\r  judging ${d}/${t}`),
        });
        process.stdout.write("\n");
        console.log(
          `✓ score ${label}: retrieved ${res.retrieved}, judged ${res.judged}, escalated ${res.escalated}, failed ${res.failed}, skipped(unenriched) ${res.skippedUnenriched}`,
        );
        break;
      }
      case "eval": {
        const sub = _[1] ?? "run";
        if (sub === "scaffold") {
          const items = await scaffoldEvalSet(db, num(flags.n) ?? 50);
          const out = typeof flags.out === "string" ? flags.out : "eval.json";
          await writeFile(out, JSON.stringify(items, null, 2), "utf8");
          console.log(`✓ wrote ${items.length} unlabeled candidates -> ${out} (label each yes/no/borderline)`);
        } else {
          const label = _[2] ?? (typeof flags.profile === "string" ? flags.profile : undefined);
          if (!label) throw new Error("usage: jr eval run <profile> [--file eval.json]");
          const file = typeof flags.file === "string" ? flags.file : "eval.json";
          const items = JSON.parse(await readFile(file, "utf8")) as EvalItem[];
          const rep = await runEval(db, label, items, [5, 10]);
          console.log(`Eval: ${label}`);
          console.log(`  labeled ${rep.labeled} (${rep.yesCount} yes) · scored ${rep.scored}`);
          for (const k of Object.keys(rep.precisionAt)) {
            console.log(`  precision@${k}: ${rep.precisionAt[Number(k)]!.toFixed(2)}`);
          }
        }
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
        console.log(`  eligible:    ${s.jobsEligible}  (geo: India / remote / Dubai / Singapore)`);
        console.log(`  targeted:    ${s.jobsTargeted}  (geo + engineering role families)`);
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

  P3 discovery:
  pnpm jr discover domain <d>     detect one domain's ATS (add --agent for misses)
  pnpm jr discover yc --limit 500 import YC companies, detect + register ATS
  pnpm jr discover domains <file> detect from a newline-separated domains file
  pnpm jr discover workday <host> <site> [name]   add a Workday company
  pnpm jr discover oracle <host> <siteNumber> <siteName> [name]  add an Oracle Cloud company
  pnpm jr discover ... --agent    resolve regex misses with the LLM agent (needs key)
  pnpm jr liveness                mark stale/dead, report failing %

  P4 ingestion (non-ATS sources):
  pnpm jr ingest hn               parse the latest HN "Who is hiring" thread
  pnpm jr ingest email <file>     parse a saved job-alert email (LinkedIn/Wellfound/…)
  pnpm jr ingest remote           pull free remote boards (Remotive/RemoteOK/Arbeitnow)
  pnpm jr digest [--dry-run]      build + send the daily digest
  pnpm jr digest --top 15 --since 3

  P2 matching (needs OPENAI_API_KEY + ANTHROPIC_API_KEY):
  pnpm jr profiles seed           upsert the 3 archetype profiles
  pnpm jr profiles embed          embed profile summaries (OpenAI)
  pnpm jr enrich [--limit N]      extract + distill + embed stage-0 jobs
  pnpm jr retrieve <profile>      debug stage-1 hybrid retrieval (FTS works w/o keys)
  pnpm jr score <profile>         stage-1 -> stage-2 judge, writes job_scores
  pnpm jr eval scaffold [--n 50]  write an unlabeled eval set to label by hand
  pnpm jr eval run <profile>      measure precision@10 against labels

  pnpm jr export [path]           write applications.csv for the job-search skill
  pnpm jr stats                   show pipeline counts
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
