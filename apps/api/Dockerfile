FROM oven/bun:1.4.4 AS deps
WORKDIR /app

COPY package.json bun.lock ./
COPY apps/api/package.json apps/api/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/storage/package.json packages/storage/package.json
RUN bun install --frozen-lockfile

FROM oven/bun:1.4.4
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/apps/worker/node_modules ./apps/worker/node_modules

COPY package.json bun.lock tsconfig.base.json ./
COPY apps/api ./apps/api
COPY apps/worker ./apps/worker
COPY packages ./packages

CMD ["bun", "run", "apps/api/src/index.ts"]
