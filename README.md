# Job Radar

Personal job-discovery pipeline. Crawls source-of-truth ATS JSON endpoints (Greenhouse, Lever, Ashby), normalizes and dedupes into Postgres, and emails a daily digest. See [`design.md`](design.md) for the full rationale and [`CLAUDE.md`](CLAUDE.md) for the operating contract.

**Status: P0 complete** — crawl → normalize → dedupe → stage-0 filter → digest. No UI, no LLM yet.

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
| `pnpm jr stats` | show counts |

## Layout

```
packages/core     schema, types, adapters, pipeline, dedupe, filters, digest
apps/worker       the `jr` CLI (and later the scheduler)
apps/web          Next.js triage UI (P1, not built yet)
```

## Adding an ATS source

One file in `packages/core/src/adapters/` implementing `SourceAdapter`, registered in `adapters/index.ts`, with a fixture test against one real payload. Adapters only `fetch` + `normalize` — the pipeline owns the database (see `CLAUDE.md` invariants).

## Tests

```bash
pnpm test        # adapter normalization + dedupe key logic
pnpm typecheck
```
