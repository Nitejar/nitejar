#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_DB="${ROOT_DIR}/packages/database/data/nitejar.db"
TARGET_DB="${ROOT_DIR}/packages/database/data/nitejar.screenshots.db"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required but not installed." >&2
  exit 1
fi

if [[ ! -f "${SOURCE_DB}" ]]; then
  echo "Source DB not found at ${SOURCE_DB}" >&2
  exit 1
fi

rm -f "${TARGET_DB}" "${TARGET_DB}-wal" "${TARGET_DB}-shm"

# Use SQLite's backup command for a consistent copy.
sqlite3 "${SOURCE_DB}" ".backup '${TARGET_DB}'"

echo "Created isolated screenshot DB: ${TARGET_DB}"

DATABASE_URL="${TARGET_DB}" pnpm --filter @nitejar/web exec tsx scripts/screenshot/seed-demo-data.ts

echo
echo "Screenshot environment is ready."
echo "Start isolated app server:"
echo "  DATABASE_URL=${TARGET_DB} APP_BASE_URL=http://localhost:3003 pnpm --filter @nitejar/web dev -- --port 3003"
echo
echo "Main DB remains untouched: ${SOURCE_DB}"
