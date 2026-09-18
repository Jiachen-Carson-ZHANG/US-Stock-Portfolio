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
# Next deliberately leaves the static assets out of it, expecting a CDN to serve
# them. Nothing else serves them here, so they are copied in beside the server —
# without this every page loads with no CSS.
echo "Assembling the standalone bundle..."
cp -r .next/static .next/standalone/.next/static
if [ -d public ]; then cp -r public .next/standalone/public; fi

echo "Build completed successfully!"
