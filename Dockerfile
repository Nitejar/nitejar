# syntax=docker/dockerfile:1

# Base image with Node.js 24 (required for @fly/sprites)
FROM node:24-slim AS base

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

# Build stage
FROM base AS builder
WORKDIR /app

# Install build dependencies for better-sqlite3
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/web/package.json ./apps/web/
COPY packages/agent/package.json ./packages/agent/
COPY packages/config/package.json ./packages/config/
COPY packages/connectors-github/package.json ./packages/connectors-github/
COPY packages/core/package.json ./packages/core/
COPY packages/database/package.json ./packages/database/
COPY packages/integrations/package.json ./packages/integrations/
COPY packages/sprites/package.json ./packages/sprites/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/typescript-config/package.json ./packages/typescript-config/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Generate database migrations
RUN pnpm db:generate

# Build the application
RUN pnpm build

# Production stage
FROM base AS runner
WORKDIR /app

# Create non-root user
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

# Copy database migration script (Kysely-based)
COPY --from=builder /app/packages/database/src/migrate.ts ./packages/database/src/migrate.ts

# Create data directory for SQLite
RUN mkdir -p /app/data && chown -R nextjs:nodejs /app/data

# Set ownership
RUN chown -R nextjs:nodejs /app

USER nextjs

# Environment
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Default SQLite database path
ENV DATABASE_URL=/app/data/nitejar.db

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/ || exit 1

# Start the application
CMD ["node", "apps/web/server.js"]
