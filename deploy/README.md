# Running Job Radar as a local service (macOS)

Single-user, local deploy. Two macOS LaunchAgents keep the web UI up independent
of any terminal/session, and keep the Mac awake while on AC power.

- `com.jobradar.web` — runs `pnpm start` (production `next start -p 3005`) in
  `apps/web`, `RunAtLoad` (starts on login) + `KeepAlive` (restarts on crash).
- `com.jobradar.caffeinate` — `caffeinate -s` (prevents *system* sleep only while
  on AC; on battery the Mac sleeps normally).

The Postgres container (`docker-compose.yml`) has `restart: unless-stopped`, so it
comes back with Docker. **Enable Docker Desktop → Settings → "Start Docker Desktop
when you sign in"** so the DB is up before the web agent needs it.

## Install / reinstall

```bash
cp deploy/launchd/*.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jobradar.web.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.jobradar.caffeinate.plist
```

(The plists hardcode this machine's paths for pnpm/node — update them if node or
the repo location changes. Rebuild the app after code changes: `pnpm --filter
@job-radar/web build`, then `launchctl kickstart -k gui/$(id -u)/com.jobradar.web`.)

## Manage

```bash
launchctl list | grep jobradar                                  # status (pid, exit code)
launchctl kickstart -k gui/$(id -u)/com.jobradar.web            # restart web (after a rebuild)
launchctl bootout gui/$(id -u)/com.jobradar.web                 # stop + unload web
launchctl bootout gui/$(id -u)/com.jobradar.caffeinate          # stop keeping awake
tail -f ~/Library/Logs/jobradar-web.out.log                     # logs
```

App: http://localhost:3005 (localhost-only; use `?profile=agent-llm-infra` for the
ranked view). To reach it from your other devices privately, put the Mac on
Tailscale and use its tailnet address — do not expose port 3005 publicly.

## Not automated yet: crawling

These agents keep the **UI** up; they do **not** fetch new jobs. Data refresh is
still manual:

```bash
pnpm jr crawl && pnpm jr enrich && pnpm jr score agent-llm-infra && pnpm jr digest
```

A staleness-based scheduler (design §8) that runs the crawl/enrich/score/digest
loop automatically is the next step — until then, run `jr crawl` when you want
fresh data (or add a periodic LaunchAgent / cron for it).
