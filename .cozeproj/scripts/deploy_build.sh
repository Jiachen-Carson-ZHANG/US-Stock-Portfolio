#!/bin/bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
cd "$PROJECT_DIR"

echo "Installing dependencies..."
npm ci

echo "Building the project..."
npm run build

# `output: standalone` emits a self-contained server under .next/standalone, but
# Next deliberately leaves out the static assets and public files — they are
# expected to be served by a CDN. Nothing else serves them here, so they are
# copied in beside the server or every page loads without CSS.
echo "Assembling the standalone bundle..."
cp -r .next/static .next/standalone/.next/static
[ -d public ] && cp -r public .next/standalone/public

echo "Build completed successfully!"
