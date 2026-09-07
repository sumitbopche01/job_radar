# Job Radar

Personal job-discovery pipeline. Crawls source-of-truth ATS JSON endpoints (Greenhouse, Lever, Ashby), normalizes and dedupes into Postgres, and emails a daily digest. See [`design.md`](design.md) for the full rationale and [`CLAUDE.md`](CLAUDE.md) for the operating contract.

**Status: P0–P4 in place** — crawl → normalize → dedupe → stage-0 (geo + role gates) → digest; a keyboard triage UI + applications pipeline + CSV export; the matching layer (enrichment → hybrid FTS+vector retrieval → LLM judge → precision@10 eval); company discovery (ATS detection with endpoint verification across 7 providers, token-list/YC seeds, liveness loop, resolution agent); and non-ATS ingestion (HN "Who's hiring" + job-alert emails). The LLM steps (judge, enrichment, resolution agent) need API keys; everything else runs without them.

## Quickstart

```bash
pnpm install
cp .env.example .env          # default points at the docker Postgres on :5433
pnpm db:up                    # start Postgres (pgvector/pgvector:pg17)
pnpm db:migrate               # create schema + pgvector extension
pnpm jr seed                  # load ~60 verified company boards
pnpm jr crawl                 # fetch every board -> jobs
pnpm jr dedupe                # link cross-source duplicates
pnpm jr digest --dry-run      # render the digest to the console
pnpm jr stats                 # pipeline counts
```

To actually email the digest, set `RESEND_API_KEY` and `DIGEST_TO` in `.env`, then `pnpm jr digest`.

### Triage UI

```bash
pnpm --filter @job-radar/web dev     # http://localhost:3005
```

Keyboard: `j`/`k` move · `s` shortlist · `x` reject (then a one-key reason) · `a` applied · `o` open posting · `/` search. The `/pipeline` board tracks applications (new → shortlist → applied → screen → interview → offer/rejected) with follow-up dates. `pnpm jr export applications.csv` writes the tracker for the job-search skill.

## CLI

| Command | Does |
|---|---|
| `pnpm jr migrate` | apply DB migrations |
| `pnpm jr seed` | upsert seed companies from `apps/worker/data/companies.seed.json` |
| `pnpm jr crawl` | crawl all active companies |
| `pnpm jr crawl --only ashby` | crawl one provider |
| `pnpm jr crawl --company stripe` | crawl one company by board token |
| `pnpm jr dedupe` | link cross-source duplicates |
| `pnpm jr digest [--dry-run --top N --since D]` | build + send the daily digest |
| `pnpm jr export [path]` | write applications.csv for the job-search skill |
| `pnpm jr stats` | show counts |

### Company discovery (P3)

```bash
pnpm jr discover domain vercel.com     # detect one company's ATS (verifies the token)
pnpm jr discover tokens                # import + verify apps/worker/data/discovery-tokens.txt
pnpm jr discover yc --recent --limit 500   # sweep YC companies, detect + register
pnpm jr discover domains mylist.txt    # detect from a newline-separated domains file
pnpm jr discover yc --agent --agent-limit 25   # resolve regex misses with the LLM agent
pnpm jr liveness                       # active→stale→dead, report failing %
```

Detection is a three-step ladder, each verifying tokens by probing the endpoint (dead tokens never enter the registry): **regex** on careers HTML → **guess-and-probe** (token derived from the domain/name, probed across providers — keyless, recovers most JS-rendered misses) → **resolution agent** (LLM, `--agent`, needs `ANTHROPIC_API_KEY`) for truly custom cases. The highest-yield bulk seed is a verified token list.

### Non-ATS ingestion (P4)

```bash
pnpm jr ingest hn                    # parse the latest HN "Who is hiring" thread
pnpm jr ingest email saved.html      # parse a saved job-alert email (LinkedIn/Wellfound/…)
pnpm jr discover workday nvidia.wd5.myworkdayjobs.com NVIDIAExternalCareerSite NVIDIA
```

HN comments and alert emails are stored as `jobs` under an `external` company; the geo/role gates, dedupe, triage and digest treat them like any other job. Email ingestion is file-based (save/forward the alert, then run it) — no IMAP setup needed.

### Matching (P2 — needs `OPENAI_API_KEY` + `ANTHROPIC_API_KEY`)

```bash
pnpm jr profiles seed          # 3 archetype profiles (edit apps/worker/data/profiles.seed.json)
pnpm jr profiles embed         # embed profile summaries (OpenAI)
pnpm jr enrich --limit 200     # extract → distill → embed stage-0 jobs (Anthropic + OpenAI)
pnpm jr retrieve agent-llm-infra   # stage-1 hybrid retrieval (FTS works without keys)
pnpm jr score agent-llm-infra      # stage-1 → stage-2 judge → job_scores
pnpm jr eval scaffold --n 50 --out eval.json   # then hand-label each yes/no/borderline
pnpm jr eval run agent-llm-infra --file eval.json   # precision@10
```

Then open the triage UI ranked by a profile: `http://localhost:3005/?profile=agent-llm-infra`.

Model routing lives only in [`packages/core/src/llm`](packages/core/src/llm/index.ts) (design doc §16). Profiles: `agent-llm-infra`, `fullstack-ai`, `backend-platform`.

## Layout

```
packages/core     schema, types, adapters, pipeline, dedupe, filters, triage,
                  applications, digest, llm, enrich, profiles, scoring, eval
apps/worker       the `jr` CLI (and later the scheduler)
apps/web          Next.js triage UI + pipeline board (:3005)
```

## Adding an ATS source

One file in `packages/core/src/adapters/` implementing `SourceAdapter`, registered in `adapters/index.ts`, with a fixture test against one real payload. Adapters only `fetch` + `normalize` — the pipeline owns the database (see `CLAUDE.md` invariants).

## Tests

```bash
pnpm test        # adapter normalization + dedupe key logic
pnpm typecheck
```
