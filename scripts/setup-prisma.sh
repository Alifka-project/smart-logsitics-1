#!/bin/bash
# Setup Prisma Database - Run migrations and create users

set -e

echo "🚀 Setting up Prisma Database..."
echo ""

# Check if DATABASE_URL is set
if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL environment variable is not set"
    echo ""
    echo "Please set it:"
    echo "  export DATABASE_URL=\"postgres://user:pass@host:port/db?sslmode=require\""
    echo ""
    echo "Or add to .env file"
    exit 1
fi

echo "📝 Step 1: Generating Prisma Client..."
npx prisma generate

echo ""
echo "📝 Step 2: Pushing schema to database..."
npx prisma db push --skip-generate --accept-data-loss

echo ""
echo "📝 Step 3: Creating default users..."
node src/server/seedUsers.js

echo ""
echo "✅ Prisma setup complete!"
echo ""
echo "Next steps:"
echo "  1. Test connection: npm run start:server"
echo "  2. View database: npx prisma studio"
echo ""

