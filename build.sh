#!/bin/bash

# Vercel Build Script
# This runs during deployment

echo "🔧 Starting Vercel build..."

# Set NODE_ENV
export NODE_ENV=production

# Generate Prisma Client
echo "📦 Generating Prisma Client..."
npx prisma generate

# Build frontend with Vite
echo "🏗️ Building frontend..."
npm run build

echo "✅ Build complete!"
