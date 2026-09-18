# Build and run the dashboard anywhere Docker runs.
#   docker build -t family-portfolio .
#   docker run -p 3000:3000 --env-file .env.local family-portfolio
# State lives in Postgres (DATABASE_URL), so no volume is required.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# @node-rs/argon2 is native; keep build tools out of the final image by
# compiling it here.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Seeding runs at boot, so the scripts and their sources ship too.
COPY --from=builder --chown=nextjs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nextjs:nodejs /app/src ./src
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/node_modules/tsx ./node_modules/tsx
COPY --from=builder /app/node_modules/.bin/tsx ./node_modules/.bin/tsx

# State now lives in Postgres, so the container itself is disposable — point
# DATABASE_URL at the database and no volume is needed.

USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
