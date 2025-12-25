#!/usr/bin/env bash
set -e
host=${1:-localhost}
port=${2:-5432}
shift 2 || true
cmd="$@"

until pg_isready -h "$host" -p "$port" >/dev/null 2>&1; do
  echo "Waiting for Postgres at $host:$port..."
  sleep 1
done

echo "Postgres is ready. Running: $cmd"
exec $cmd
