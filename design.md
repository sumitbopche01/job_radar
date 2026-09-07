# Job Radar — design doc

Personal job discovery system. Pulls openings from source-of-truth ATS endpoints, normalizes and dedupes them, ranks against your profile, and gives you a keyboard-driven triage queue plus a daily digest.

> This is the canonical design. `CLAUDE.md` is the short operating contract. Build one phase at a time (§11).

---

## 1. Goal and non-goals
**Goal:** see every relevant role within an hour of it going live, spend under 10 minutes a day triaging, and never manually browse a job board again.

**Non-goals:**
- Auto-apply. Never. The system drafts, you send.
- Being a general job board. Cover *your* 3 role archetypes, not everything.
- Accounts, auth, multi-user. Single user, single deploy. `profile_id` separates your three role archetypes, not tenants.
- Scraping LinkedIn with your account.

## 3. The core bet: crawl companies, not job boards
Aggregators (LinkedIn, Indeed, Naukri, Wellfound) are the downstream layer — stale, poorly deduped, anti-bot walled, legally hostile. Every company posting through Greenhouse / Lever / Ashby / Workable / SmartRecruiters / Recruitee / Workday exposes a public, unauthenticated JSON endpoint — the source of truth. The real asset is a maintained `companies` table mapping company → ATS provider → board token. That table is the moat.

### Company discovery
1. Seed import (YC, GitHub token lists, fund portfolios, levels.fyi).
2. ATS detection crawler (regex careers pages; LLM fallback <10%).
3. Expansion from signal (HN "Who is hiring", funding news, shortlists).
4. Liveness loop (404/empty for 7 days → stale → dead).

Target: 3,000–5,000 companies.

## 4. Sources, tiered
### Tier 1 — ATS endpoints (verified shapes as implemented in P0)
| Provider | Endpoint | posted_at field |
|---|---|---|
| Greenhouse | `GET boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | `first_published` |
| Lever | `GET api.lever.co/v0/postings/{token}?mode=json` | `createdAt` (epoch ms) |
| Ashby | `GET api.ashbyhq.com/posting-api/job-board/{token}?includeCompensation=true` | `publishedAt` |
| Workday | `POST {tenant}.wdN.myworkdayjobs.com/wday/cxs/{tenant}/{site}/jobs` | (P4) |
| SmartRecruiters | `GET api.smartrecruiters.com/v1/companies/{token}/postings` | — |
| Recruitee | `GET {token}.recruitee.com/api/offers/` | — |
| Workable | `GET apply.workable.com/api/v1/widget/accounts/{token}?details=true` | — |

Concurrency caps: Ashby/Workable 5, Greenhouse/Lever 30, Workday 50.
Build order: Greenhouse → Lever → Ashby (~70% of startup/scaleup tech hiring). Workday is P4.

### Tier 2 — free public feeds
Remotive, RemoteOK, Arbeitnow, WeWorkRemotely RSS, HN Algolia "Who is hiring", YC jobs, Adzuna (India).

### Tier 3 — email ingestion (LinkedIn workaround)
Saved alerts → dedicated inbox → IMAP/Gmail poll → parse title+company+link → treat as **discovery events** (pointer), let the ATS adapter fetch the real record (payload).

### Tier 4 — paid, only if a gap remains
JSearch / JobsPipe / TheirStack. Defer.

## 5. Architecture
Two deployables: `web` (Next.js) and `worker` (Node). One Postgres.
Pipeline: adapters → raw store (jsonb) → normalize + hash → dedupe → `jobs` → (lazy, post stage-0) enrich (LLM + embed) → score (S0 SQL → S1 vector → S2 LLM judge) → triage UI / digest / telegram → feedback → calibration.

**Adapter interface** — one file per source:
```ts
interface SourceAdapter {
  id: string;
  provider: AtsProvider;
  rateLimit: { concurrency: number; minDelayMs: number };
  fetch(target: CrawlTarget): Promise<RawPosting[]>;
  normalize(raw: RawPosting): CanonicalJob;
}
```
Raw payloads are stored immutably before normalization. Replay from raw when a parser changes.

## 6. Data model
See `packages/core/src/db/schema.ts`. Tables: companies, raw_postings, jobs, job_enrichment, profiles, job_scores, feedback, applications.

**Identity and dedupe.**
- Source identity: `(source, external_id)` → trivial upserts.
- Cross-source identity: `normalize(company) + normalize(title) + location_bucket`; embedding similarity for the borderline. Winner is the ATS record; others attach via `canonical_job_id`.
- `content_hash` over title+description detects edits. `first_seen_at` never moves.
- Absent for 2 consecutive crawls → `closed_at`. Never hard delete.

## 7. Matching (eval-driven, not a prompt)
Hand-label 50 jobs (15 yes / 25 no / 10 borderline) → eval set. Metric: **precision@10**.
- **Stage 0 — SQL filters.** Title blocklist, seniority floor, freshness, geo/eligibility, already-seen. Kills ~97% before any LLM.
- **Stage 1 — hybrid retrieval on a distilled ~150-token summary.** Embed the distillation, not the raw JD. FTS + pgvector fused with RRF (`1/(60+rank)`). Keep top ~60/day.
- **Stage 2 — LLM judge.** Structured output (fit_score, seniority_match, evidence, gaps, eligibility_risk, hook). Cheap model for 60, stronger for top 15. Prompt caching on the constant prefix; Batch API for backfill.
- **Calibration.** Feedback → 8 nearest labeled examples as few-shot. Re-run eval weekly.

## 8. Stack
TypeScript end to end. pnpm + Turborepo (`apps/web`, `apps/worker`, `packages/core`). Local Postgres in Docker (`pgvector/pgvector:pg17`), Drizzle, pg-boss queue, undici + p-queue, Next.js + Tailwind + shadcn, Resend digest, Telegram push. All local; schedule on **staleness**, not wall-clock cron. Nightly `pg_dump` of feedback/applications/profiles/companies. 512-dim `halfvec`.

## 9. Triage UI
One dense list, sorted by score, grouped by day. Keyboard: `j/k` move, `s` shortlist, `x` reject (with one-key reason), `o` open, `a` applied, `/` search. Right pane = LLM rubric. Applications pipeline board with `next_action_at`.

## 10. Integration with the job-search skill
Do not build a second tracker. Expose `packages/core` via an **MCP server** (`search_jobs`, `get_job`, `log_application`, `get_profile`) and a **CLI** (`jr`). Postgres owns state; `applications.csv` becomes a generated artifact. `profiles.resume_md` symlinked from `candidate-profile.md`.

## 11. Phasing
- **P0 (done):** Greenhouse + Lever + Ashby, seed companies, Postgres, normalize, dedupe, stage-0 filter, daily digest. No UI, no LLM. — *`jr crawl` fills `jobs`, re-run changes no rows, digest renders.*
- **P1:** Next.js triage UI, feedback capture, applications pipeline, CSV export.
- **P2:** eval set, enrichment + embeddings + stage 1/2 scoring + calibration.
- **P3:** company discovery (seed import + ATS detection) → 3,000 companies.
- **P4:** email-alert ingestion, Workday adapter, HN parser.
- **P5:** drafting handoff to the job-search skill (mostly not built here).

## 12. Cost
Under $15/month. Filters gate before the LLM.

## 13. Failure modes
Ranking mediocrity (eval set + precision@10), token rot (liveness loop), over-collection, rebuilding the tracker, scope creep into auto-apply.

## 16. Where the AI goes
Most of the system is **not** agentic. Two agents earn their place: ATS resolution (bounded 6-step loop, terminates on a verifiable fact) and company research on shortlist (fixed schema, source URL per claim). Scoring, normalization, dedupe, adapter self-repair are explicitly **not** agents.
Model routing lives only in `packages/core/llm.ts` (P2+): embeddings `text-embedding-3-small` @512, extraction/judge-first cheap tier + cached prefix, judge-top-15 mid tier, research agent mid tier.
