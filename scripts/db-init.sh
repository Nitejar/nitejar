#!/bin/bash
set -e

echo "Waiting for Postgres to be ready..."

# Wait for Postgres to be ready
until docker compose exec -T postgres pg_isready -U nitejar > /dev/null 2>&1; do
  echo "Postgres is unavailable - sleeping"
  sleep 1
done

echo "Postgres is ready!"

echo "Applying schema..."
docker compose exec -T postgres psql -U nitejar -d nitejar < packages/database/src/schema.sql

echo "Database initialized successfully!"
