# syntax=docker/dockerfile:1.6

# ---------------------------------------------------------------------------
# Provider-agnostic Dockerfile for NBEVHAI Cloud Waiver App (Next.js 15).
#
# Build args / env vars intentionally use GENERIC names:
#   POSTGRES_URL, API_BEARER_TOKEN, NEXT_PUBLIC_APP_URL,
#   BLOB_DRIVER, BLOB_LOCAL_DIR, S3_* ...
# No cloud-provider brand names appear anywhere in this file.
#
# 3-stage build: deps (cache node_modules) -> builder (next build)
#               -> runner (node-only, non-root user, ~200 MB)
#
# NOTE: `deps-all` installs devDependencies too.  The Next.js SWC pipeline
# needs a full `node_modules` tree (including typescript/eslint packages
# referenced by tsconfig.json plugins) in order to correctly resolve
# tsconfig `paths` aliases like `@/lib/*`.  The runner stage still copies
# from the lean `deps-prod` install for a small final image.
# ---------------------------------------------------------------------------

FROM node:20-alpine AS deps-base
WORKDIR /app

# Alpine native deps for npm/node-gyp when needed (pg, sharp-like pkgs, crypto)
RUN apk add --no-cache libc6-compat python3 make g++

COPY package.json package-lock.json* ./

# ------- Deps: production-only (used by the final RUNNER image) ------------
FROM deps-base AS deps-prod
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then \
      npm ci --omit=dev --no-audit --no-fund --loglevel=error; \
    else \
      npm install --omit=dev --no-audit --no-fund --loglevel=error; \
    fi

# ------- Deps: full install including devDeps (used only by BUILDER) -------
FROM deps-base AS deps-all
RUN --mount=type=cache,target=/root/.npm \
    if [ -f package-lock.json ]; then \
      npm ci --no-audit --no-fund --loglevel=error; \
    else \
      npm install --no-audit --no-fund --loglevel=error; \
    fi

# ---------------------- Builder stage (full deps for next build) -----------
FROM node:20-alpine AS builder
WORKDIR /app

# Next standalone build needs this env so it writes output to the right place
# The builder also runs `next build` with WAIVER_HASH_SECRET set so Next's
# static page-data collection phase (which imports our access lib on the
# server) does not fail on startup-env checks.  The builder-side value is
# NOT the runtime secret; the real secret is injected at compose/k8s start.
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    WAIVER_HASH_SECRET=build-time-stub-secret-needs-24-chars-min \
    WAIVER_HASH_REQUIRED=true \
    ADMIN_API_AUTH_REQUIRED=false \
    API_BEARER_TOKEN=build-time-stub-bearer-token-8ch-min

COPY --from=deps-all /app/node_modules ./node_modules
COPY . .

# Build.  On OOM / slow builder hosts, 2 GiB heap is enough for this small app.
ENV NODE_OPTIONS="--max-old-space-size=2048"
RUN npx --no-install next build

# ---------------------- Runner stage (production-only) ---------------------
FROM node:20-alpine AS runner
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    # Default driver = local filesystem blob store.  Mount a volume at
    # /app/.blob-store for durability, or set BLOB_DRIVER=s3 + S3_* at runtime.
    BLOB_DRIVER=local \
    BLOB_LOCAL_DIR=/app/.blob-store

RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs \
 && mkdir -p /app/.blob-store /app/public \
 && chown -R nextjs:nodejs /app

# Next.js standalone build outputs the minimal node server here:
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Bring in the PRODUCTION-ONLY node_modules too: Next standalone output
# sometimes does not bundle 100% of native deps (e.g. pg native bindings)
# so we layer the lean production-only install right next to the server code.
COPY --from=deps-prod --chown=nextjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/static   ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public         ./public
# Raw SQL migration file so `docker compose run migrate` can apply it
# using the same Node driver as the app (see docker-compose entrypoint).
COPY --chown=nextjs:nodejs migrations /app/migrations

USER nextjs

EXPOSE 3000/tcp

HEALTHCHECK --interval=20s --timeout=5s --start-period=40s --retries=6 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/',(r)=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"

# Next.js standalone server entrypoint (generated at build time by Next).
CMD ["node", "server.js"]
