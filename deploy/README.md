# Running Job Radar as a local service (macOS)

Single-user, local deploy. The whole app runs in **Docker** (via `docker-compose.yml`),
so it comes back on its own after a reboot and keeps refreshing the data on a schedule.

Services (all `restart: unless-stopped` except the one-shot migrate):

- **db** — Postgres (`pgvector/pgvector:pg17`), host port 5433, named volume.
- **migrate** — one-shot, applies DB migrations before web/refresh start.
- **web** — the triage UI (`next start`) on http://localhost:3005.
- **refresh** — runs `jr refresh` (all ATS boards + remote boards + HN + dedupe)
  immediately on start and then **every 8 hours (3×/day)**.

One macOS LaunchAgent remains:

- **com.jobradar.caffeinate** — `caffeinate -s` prevents *system* sleep while on AC,
  so the scheduled refresh fires. (On battery the Mac sleeps normally.)

## Auto-start on boot

1. **Docker Desktop → Settings → General → "Start Docker Desktop when you sign in"** — enable it.
2. The containers have `restart: unless-stopped`, so once Docker is up they start themselves.

Together that means: power on → Docker starts → db/web/refresh come up → a refresh runs.

## Install / start

```bash
docker compose up -d --build        # build the app image + start everything
cp deploy/launchd/com.jobradar.caffeinate.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jobradar.caffeinate.plist
```

App: http://localhost:3005 (localhost-only; use `?profile=agent-llm-infra` for the
ranked view). To reach it from your other devices privately, put the Mac on
Tailscale and use its tailnet address — do not expose port 3005 publicly.

## Manage

```bash
docker compose ps                   # status of db / web / refresh
docker compose logs -f web          # web logs
docker compose logs -f refresh      # watch a refresh run
docker compose up -d --build        # rebuild + restart after code changes
docker compose restart web          # restart just the UI
docker compose exec refresh pnpm jr refresh   # force a refresh now
docker compose down                 # stop everything (data persists in the volume)
```

Note: `jr` CLI commands run from the host (e.g. `pnpm jr stats`, `pnpm jr enrich`)
talk to the same DB over host port 5433 — unchanged.

## The LLM steps are not in the scheduled refresh

`jr refresh` is keyless (crawl + ingest + dedupe). Enrichment, scoring and digests
need API keys/credit and are run on demand:

```bash
pnpm jr enrich && pnpm jr score agent-llm-infra
```
