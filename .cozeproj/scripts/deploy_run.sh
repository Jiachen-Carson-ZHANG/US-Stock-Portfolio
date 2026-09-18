#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

export PORT="${DEPLOY_RUN_PORT:-5000}"
export HOSTNAME="0.0.0.0"

# Next's standalone server chdirs into its own directory, so a relative SQLite
# path would resolve inside .next/standalone and the app would silently come up
# against an empty database — every sign-in rejected, no error anywhere.
case "${DATABASE_URL:-}" in
  file:/*) ;;
  file:*) export DATABASE_URL="file:${PROJECT_DIR}/${DATABASE_URL#file:./}" ;;
esac

# Creating the schema is idempotent and seeding never rewrites an existing
# account, so this is safe on every boot — it is what gives a fresh container
# its tables and its sign-ins.
echo "Preparing database..."
npm run db:seed

# `next start` does not work with output: standalone — Next 16 warns and serves
# a broken app. The standalone server is the supported entry point.
echo "Starting HTTP service on port ${PORT} for deploy..."
exec node .next/standalone/server.js
