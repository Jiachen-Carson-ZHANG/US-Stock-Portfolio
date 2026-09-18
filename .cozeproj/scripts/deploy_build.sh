#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

echo "Installing dependencies..."
# better-sqlite3 and @node-rs/argon2 are native; ci must not skip their build.
npm ci

echo "Building the project..."
npm run build

echo "Build completed successfully!"
