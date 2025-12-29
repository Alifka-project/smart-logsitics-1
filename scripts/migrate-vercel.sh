#!/bin/bash
# Script to migrate Vercel Postgres database
# Usage: ./scripts/migrate-vercel.sh YOUR_DATABASE_URL

set -e

if [ -z "$1" ]; then
    echo "❌ Error: DATABASE_URL is required"
    echo ""
    echo "Usage:"
    echo "  ./scripts/migrate-vercel.sh postgres://user:pass@host:port/dbname"
    echo ""
    echo "Or set DATABASE_URL environment variable:"
    echo "  export DATABASE_URL='postgres://user:pass@host:port/dbname'"
    echo "  ./scripts/migrate-vercel.sh"
    echo ""
    exit 1
fi

DATABASE_URL="${1:-$DATABASE_URL}"

if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL is required"
    exit 1
fi

echo "🚀 Migrating Vercel Postgres Database..."
echo ""

# Check if psql is installed
if ! command -v psql &> /dev/null; then
    echo "❌ Error: psql is not installed"
    echo ""
    echo "Install psql:"
    echo "  Mac: brew install postgresql"
    echo "  Linux: sudo apt-get install postgresql-client"
    echo "  Windows: Download from https://www.postgresql.org/download/windows/"
    echo ""
    exit 1
fi

# Run migration
echo "📝 Running migration..."
psql "$DATABASE_URL" -f db/migrations/001_create_drivers_and_locations.sql

echo ""
echo "✅ Migration completed!"
echo ""
echo "📝 Next steps:"
echo "  1. Create users: node src/server/seedUsers.js"
echo "  2. (Set DATABASE_URL environment variable first)"
echo ""

