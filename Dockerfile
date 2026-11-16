# One image for the whole app: the Next.js web UI (`next start`) and the worker
# CLI (`jr`, run via tsx). Built once, used by the web / refresh / migrate
# services in docker-compose.yml.
FROM node:20-slim

# git is handy for some tooling; pnpm via corepack pinned to the repo's version.
RUN corepack enable && corepack prepare pnpm@9.5.0 --activate

WORKDIR /app

# Full monorepo. devDependencies are needed at runtime (tsx for the worker) and
# at build time (next/typescript), so install happens before NODE_ENV=production.
COPY . .
RUN pnpm install --frozen-lockfile \
 && pnpm --filter @job-radar/web build

ENV NODE_ENV=production
EXPOSE 3005

# Default command is the web server; compose overrides it for refresh/migrate.
CMD ["pnpm", "--filter", "@job-radar/web", "exec", "next", "start", "-p", "3005", "-H", "0.0.0.0"]
