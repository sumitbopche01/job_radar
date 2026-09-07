# Job Radar

Personal job-discovery pipeline. Crawls source-of-truth ATS JSON endpoints (Greenhouse, Lever, Ashby), normalizes and dedupes into Postgres, and emails a daily digest. See [`design.md`](design.md) for the full rationale and [`CLAUDE.md`](CLAUDE.md) for the operating contract.

**Status: P2 in place** — crawl → normalize → dedupe → stage-0 → digest, a keyboard triage UI + applications pipeline + CSV export, and the matching layer: enrichment (extract → distilled summary → embed), stage-1 hybrid retrieval (FTS + pgvector via RRF), a stage-2 LLM judge, and an eval harness for precision@10. The LLM steps need API keys (below); FTS retrieval and eval scaffolding run without them.

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
