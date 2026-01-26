#!/bin/bash

# Quick Vercel Environment Check
# This script helps you understand what needs to be set on Vercel

echo "🔍 VERCEL LOGIN ERROR DIAGNOSIS"
echo "==============================="
echo ""
echo "❌ Error You're Getting:"
echo "   POST /api/auth/login → 503 Service Unavailable"
echo ""
echo "🎯 Root Cause:"
echo "   DATABASE_URL is NOT set (or not correct) on Vercel"
echo ""
echo "✅ Solution:"
echo "   Set DATABASE_URL on Vercel Dashboard"
echo ""
echo "===============================\n"

# Check local .env
echo "1️⃣  Current .env file:"
if [ -f ".env" ]; then
  echo "   File exists ✅"
  if grep -q "^DATABASE_URL=" .env; then
    dburl=$(grep "^DATABASE_URL=" .env | cut -d'=' -f2)
    echo "   DATABASE_URL is set: ${dburl:0:50}..."
  else
    echo "   ⚠️  DATABASE_URL is NOT in .env file"
  fi
else
  echo "   .env file not found"
fi

echo ""
echo "2️⃣  What Vercel needs:"
echo "   ✅ DATABASE_URL = postgresql://... (your database connection)"
echo ""
echo "3️⃣  Steps to fix:"
echo "   1. Go to: https://vercel.com/dashboard"
echo "   2. Select: smart-logistics-1 project"
echo "   3. Click: Settings → Environment Variables"
echo "   4. Add/Update DATABASE_URL with your PostgreSQL connection string"
echo "   5. Redeploy the project"
echo ""
echo "4️⃣  Expected PostgreSQL URL format:"
echo "   postgresql://user:password@host:port/database?sslmode=require"
echo ""
echo "5️⃣  After setting DATABASE_URL:"
echo "   - Redeploy on Vercel"
echo "   - Wait 2-3 minutes"
echo "   - Try login again"
echo ""
echo "6️⃣  Test if it works:"
echo "   curl https://smart-logistics-1.vercel.app/api/health"
echo "   Should return: {\"ok\":true,\"database\":\"connected\"}"
echo ""
