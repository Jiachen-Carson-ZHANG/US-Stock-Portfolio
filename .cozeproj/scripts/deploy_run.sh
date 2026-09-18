#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

PORT="${DEPLOY_RUN_PORT:-5000}"

# The schema is created on first connect and seeding is idempotent, so this is
# safe to run on every boot — it is what gives a fresh container its accounts.
echo "Preparing database..."
npm run db:seed

echo "Starting HTTP service on port ${PORT} for deploy..."
exec npx next start --hostname 0.0.0.0 --port "${PORT}"
