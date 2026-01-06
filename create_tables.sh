#!/bin/bash
echo "🚀 Creating database tables..."
echo ""

# Use DIRECT connection (not Accelerate) to create tables
export DATABASE_URL="postgres://6a81efaf74f4a117a2bd64fd43af9aae5ad5209628abe313dc93933e468e2a64:sk_ayxWM3HTphNUmIhEUYv__@db.prisma.io:5432/postgres?sslmode=require"

echo "Step 1: Pushing schema to database..."
npx prisma db push

echo ""
echo "Step 2: Creating default users..."
node src/server/seedUsers.js

echo ""
echo "✅ Done! Tables created and users seeded."
