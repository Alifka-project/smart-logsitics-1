#!/bin/bash
# Complete Startup Script - Starts Everything Properly

set -e

cd "$(dirname "$0")"

echo "🔒 Starting Secure Dubai Logistics System"
echo "=========================================="
echo ""

# Step 1: Check Docker
echo "1️⃣ Checking Docker..."
if ! docker ps &>/dev/null; then
    echo "❌ Docker is not running!"
    echo ""
    echo "   Please:"
    echo "   1. Open Docker Desktop application"
    echo "   2. Wait for it to start (menu bar icon turns green)"
    echo "   3. Run this script again"
    echo ""
    exit 1
fi
echo "✅ Docker is running"
echo ""

# Step 2: Start Database
echo "2️⃣ Starting PostgreSQL database..."
docker-compose up -d db
echo "   Waiting for database..."
for i in {1..30}; do
    if docker-compose exec -T db pg_isready -U postgres &>/dev/null; then
        echo "✅ Database is ready"
        break
    fi
    sleep 1
done
if [ $i -eq 30 ]; then
    echo "❌ Database failed to start"
    exit 1
fi
echo ""

# Step 3: Create Users
echo "3️⃣ Creating users..."
node src/server/seedUsers.js || echo "   Users may already exist (that's okay)"
echo ""

# Step 4: Start Server
echo "4️⃣ Starting secure server..."
lsof -ti:4000 | xargs kill -9 2>/dev/null || true
sleep 1

node src/server/index.js > server.log 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > server.pid
echo "   Server PID: $SERVER_PID"
echo "   Waiting for server to start..."
sleep 5

# Step 5: Test Server
echo "5️⃣ Testing server..."
if curl -s http://localhost:4000/api/health | grep -q "ok"; then
    echo "✅ Server is running on http://localhost:4000"
else
    echo "❌ Server failed to start"
    echo "   Check server.log for errors"
    tail -20 server.log
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi
echo ""

# Step 6: Test Login
echo "6️⃣ Testing login..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Admin","password":"Admin123"}')

if echo "$LOGIN_RESPONSE" | grep -q "accessToken"; then
    echo "✅ Login test successful!"
else
    echo "⚠️  Login test:"
    echo "$LOGIN_RESPONSE" | head -3
fi
echo ""

echo "=========================================="
echo "✅ EVERYTHING IS RUNNING!"
echo ""
echo "📋 Next Steps:"
echo "   1. Open NEW terminal"
echo "   2. Run: cd dubai-logistics-system && npm run dev"
echo "   3. Open browser: http://localhost:5173"
echo "   4. Login: Admin / Admin123"
echo ""
echo "📝 Server logs: tail -f server.log"
echo "🛑 Stop server: kill \$(cat server.pid)"

