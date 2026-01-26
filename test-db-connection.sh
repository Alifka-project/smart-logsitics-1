#!/bin/bash

# Database Connection Test Script
# This helps diagnose why login is failing

echo "🔍 PRODUCTION DIAGNOSTICS"
echo "=========================="
echo ""

# Check if DATABASE_URL is set locally
echo "1️⃣  Checking local environment..."
if [ -z "$DATABASE_URL" ]; then
  echo "❌ DATABASE_URL not set in shell environment"
else
  echo "✅ DATABASE_URL is set"
  echo "   First 50 chars: ${DATABASE_URL:0:50}..."
fi

echo ""
echo "2️⃣  Checking .env file..."
if [ -f ".env" ]; then
  if grep -q "DATABASE_URL" .env; then
    echo "✅ DATABASE_URL found in .env"
    grep "DATABASE_URL" .env | head -1 | sed 's/.*/   DATABASE_URL=[MASKED]/'
  else
    echo "❌ DATABASE_URL NOT in .env file"
  fi
else
  echo "❌ .env file not found"
fi

echo ""
echo "3️⃣  Testing database connection..."
node -e "
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

console.log('Environment:');
console.log('  DATABASE_URL:', process.env.DATABASE_URL ? 'SET (' + process.env.DATABASE_URL.substring(0, 40) + '...)' : 'NOT SET');
console.log('  NODE_ENV:', process.env.NODE_ENV || 'not set');

if (!process.env.DATABASE_URL) {
  console.log('\\n❌ ERROR: DATABASE_URL is missing!');
  process.exit(1);
}

const prisma = new PrismaClient();
(async () => {
  try {
    console.log('\\nTesting connection...');
    const result = await prisma.\$queryRaw\`SELECT 1 as test\`;
    console.log('✅ Database connection successful!');
    process.exit(0);
  } catch (error) {
    console.log('❌ Database connection FAILED');
    console.log('Error:', error.message);
    if (error.message.includes('Can\\'t reach database')) {
      console.log('\\n⚠️  Database server is unreachable');
      console.log('Possible causes:');
      console.log('  1. Wrong host/port in DATABASE_URL');
      console.log('  2. Database is not running');
      console.log('  3. Network/firewall blocking access');
      console.log('  4. SSL/TLS connection issue');
    }
    process.exit(1);
  } finally {
    await prisma.\$disconnect();
  }
})();
"

echo ""
echo "4️⃣  Checking if server can start..."
node -e "
require('dotenv').config();
const app = require('./api/index.js');
if (app) {
  console.log('✅ Express app loaded successfully');
} else {
  console.log('❌ Failed to load Express app');
}
" 2>&1 | head -20

echo ""
echo "=========================="
echo "📋 WHAT TO DO NEXT:"
echo "=========================="
echo ""
echo "❌ If DATABASE_URL not found:"
echo "   1. Open .env file"
echo "   2. Add your database connection string"
echo "   3. Format: DATABASE_URL=\"postgresql://user:pass@host:port/db\""
echo ""
echo "❌ If connection fails:"
echo "   1. Verify the DATABASE_URL is correct"
echo "   2. Test with: psql \"YOUR_DATABASE_URL\" -c \"SELECT 1\""
echo "   3. Check database is running and accessible"
echo ""
echo "✅ After fixing .env:"
echo "   1. Commit: git add -A && git commit -m \"Update DATABASE_URL\""
echo "   2. Push: git push origin main"
echo "   3. Redeploy on Vercel"
echo "   4. Test: curl https://smart-logistics-1.vercel.app/api/health"
echo ""
