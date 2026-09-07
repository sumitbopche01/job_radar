# Job Radar — operating notes

Personal job-discovery pipeline. Crawls ATS JSON endpoints → normalize → dedupe → `jobs` → (later) score → triage/digest. See `design.md` for the full rationale. This file is the short operating contract; read `design.md` when you need the "why".

## Toolchain
- pnpm workspaces + TypeScript, ESM everywhere. Node 20+.
- Run TS directly with `tsx` (no build step needed for the worker/CLI in P0).
- Postgres runs in Docker (`pgvector/pgvector:pg17`) on host port **5433**.

## Commands
- `pnpm db:up` — start Postgres.
- `pnpm db:generate` — generate a migration from schema changes.
- `pnpm db:migrate` — apply migrations.
- `pnpm db:studio` — Drizzle Studio (eyeball rows while tuning).
- `pnpm jr <cmd>` — the CLI. `pnpm jr crawl`, `pnpm jr crawl --only greenhouse`, `pnpm jr crawl --company stripe`, `pnpm jr digest`, `pnpm jr seed`, `pnpm jr stats`.
- `pnpm test` — vitest (adapter fixtures + dedupe).

## Invariants (do not break)
- **Adapters never write to `jobs` directly.** An adapter only `fetch`es and `normalize`s. The pipeline owns raw storage, dedupe, and the `jobs` upsert.
- **Raw payloads are immutable.** `raw_postings` is append-on-change (keyed by `content_hash`). To fix a bad parser, replay from raw — never re-crawl to repair.
- **`first_seen_at` never moves.** It's the freshness signal. Only `last_seen_at`/`content_hash` update on re-crawl.
- **`posted_at` is the real publish date, not `updated_at`.** Greenhouse=`first_published`, Lever=`createdAt`, Ashby=`publishedAt`. Getting this wrong destroys freshness ranking.
- Source identity is `(source, external_id)` → idempotent upsert. Re-running a crawl with no board changes must change **zero** rows in `jobs`.
- Cross-source dedupe attaches losers to a winner via `canonical_job_id`; it never hard-deletes.
- A job absent from its board for 2 consecutive crawls gets `closed_at` set (soft close).

## Adding a source
One file in `packages/core/src/adapters/`, implementing `SourceAdapter` (`packages/core/src/types.ts`). Register it in `adapters/index.ts`. Add a fixture test against one real payload before trusting the normalizer — field names differ per ATS and the plausible mapping is often wrong.

## Layout
- `packages/core` — schema, types, adapters, pipeline, dedupe, digest. The shared library.
- `apps/worker` — the `jr` CLI and (later) the pg-boss scheduler.
- `apps/web` — Next.js triage UI (P1, not built yet).

## Phase status
- **P0 (current):** Greenhouse + Lever + Ashby, seed companies, crawl → normalize → dedupe → stage-0 filter → digest. No UI, no LLM.
