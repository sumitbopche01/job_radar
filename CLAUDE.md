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
- `pnpm jr <cmd>` — the CLI. `pnpm jr crawl`, `pnpm jr crawl --only greenhouse`, `pnpm jr crawl --company stripe`, `pnpm jr digest`, `pnpm jr export`, `pnpm jr seed`, `pnpm jr stats`.
- `pnpm --filter @job-radar/web dev` — triage UI on :3005.
- `pnpm test` — vitest (adapter fixtures + dedupe).

## Eligibility (geo gate)
`packages/core/src/filters/eligibility.ts` is the single source of truth for "where can I work" (design §14.3): India (incl. Bengaluru), remote-doable-from-India (generic/global remote, Asia/APAC), Dubai/UAE, Singapore. Allowlist logic — a remote role pinned to a non-eligible city (e.g. "San Francisco", "Remote - US") is dropped. It's a coarse gate applied in every candidate query (stage-0/digest, triage, enrich, retrieve, eval); the LLM judge still reports fine-grained `eligibility_risk`. `jr stats` shows the eligible count.

## Role target (what we search for)
`packages/core/src/filters/roles.ts` is the single source of truth for target roles — a positive allowlist (stage-0 is otherwise a denylist that keeps everything non-blocked). Families: AI/ML/LLM engineer (incl. research/applied scientist, member of technical staff), Forward Deployed / Solutions engineer, Backend/Platform/Infra, General SWE/Full-stack (SDE). Applied in every candidate query alongside the geo gate. Funnel in `jr stats`: open → eligible (geo) → targeted (geo + role). Note "solutions engineer/architect" are intentionally NOT in the denylist (they're the Forward-Deployed family); "sales engineer" stays blocked.

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
- **P0 (done):** Greenhouse + Lever + Ashby, seed companies, crawl → normalize → dedupe → stage-0 filter → digest. No UI, no LLM.
- **P1 (current):** Next.js keyboard triage UI (`apps/web`, :3005), feedback capture, applications pipeline board, `jr export` CSV for the job-search skill.
  - Triage queue = open + canonical + fresh + not-blocklisted + not-yet-actioned. `s` shortlist, `x` reject (+one-key reason → `feedback`), `a` applied, `o` open, `j/k` nav, `/` search.
  - Actions live in `apps/web/app/actions.ts`; DB pool singleton in `apps/web/lib/db.ts`.
  - web imports core's `.ts` sources → `next.config.ts` sets `extensionAlias` so `.js` specifiers resolve.
- **P2 (current):** matching. `packages/core/src/llm` is the ONLY place model strings live (hybrid: OpenAI `text-embedding-3-small`@512 for embeddings, Anthropic Haiku for extract + first-pass judge, Sonnet for the top-15 escalation). Pipeline: `enrich` (extract → distilled ~150-tok summary → embed) → stage-1 hybrid retrieval (Postgres FTS + pgvector fused with RRF, `scoring/retrieve.ts`) → stage-2 LLM judge (`scoring/score.ts`, structured output, cached profile prefix, few-shot from nearest labeled `feedback`). Eval harness (`eval/`) measures precision@10.
  - FTS/vector indexes are DB-only (generated tsvector + GIN + HNSW) and ensured idempotently via `ensureSearchIndexes` (`db/fts.ts`), NOT a tracked migration.
  - Needs `OPENAI_API_KEY` + `ANTHROPIC_API_KEY`. Without them: FTS retrieval and eval scaffold still run; enrich/embed/judge don't.
  - CLI: `jr profiles seed|embed`, `jr enrich`, `jr retrieve <profile>`, `jr score <profile>`, `jr eval scaffold|run`.
  - Triage UI ranks by a profile's stage-2 score when `?profile=<label>` is set (else freshness).
- **P3 (next):** company discovery (seed import + ATS detection) → 3,000 companies.
