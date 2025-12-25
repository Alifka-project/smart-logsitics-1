#!/usr/bin/env bash
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"

echo "Starting Postgres via docker-compose..."
docker-compose -f docker-compose.yml up -d db

echo "Waiting for Postgres to become ready..."
./scripts/wait-for-db.sh localhost 5432 true

echo "Seeding admin user (if not present)..."
node src/server/seedAdmin.js || true

echo "Starting backend in background..."
nohup node src/server/index.js > server.log 2>&1 &
backend_pid=$!
echo "Backend PID: $backend_pid"

echo "Starting Vite dev server (foreground)..."
npm run dev
