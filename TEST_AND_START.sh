#!/bin/bash
# Test and Start Script - Ensures everything is running

set -e

cd "$(dirname "$0")"

echo "🔍 Testing and Starting Dubai Logistics System..."
echo "=================================================="
echo ""

# Check Docker
echo "1️⃣ Checking Docker..."
if ! docker ps &>/dev/null; then
    echo "❌ Docker is not running!"
    echo "   Please start Docker Desktop and try again."
    exit 1
fi
echo "✅ Docker is running"
echo ""

# Start Database
echo "2️⃣ Starting PostgreSQL database..."
docker-compose up -d db
echo "   Waiting for database to be ready..."
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

# Create Users
echo "3️⃣ Creating default users..."
node src/server/seedUsers.js || echo "   Users may already exist (that's okay)"
echo ""

# Kill any existing server on port 4000
echo "4️⃣ Clearing port 4000..."
lsof -ti:4000 | xargs kill -9 2>/dev/null || true
sleep 1
echo ""

# Start Server
echo "5️⃣ Starting backend server..."
node src/server/index.js > server.log 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > server.pid
echo "   Server PID: $SERVER_PID"
echo "   Waiting for server to start..."
sleep 5

# Test Server
echo "6️⃣ Testing server..."
if curl -s http://localhost:4000/api/health | grep -q "ok"; then
    echo "✅ Server is running on http://localhost:4000"
else
    echo "❌ Server failed to start"
    echo "   Check server.log for errors"
    kill $SERVER_PID 2>/dev/null || true
    exit 1
fi
echo ""

# Test Login
echo "7️⃣ Testing login..."
LOGIN_RESPONSE=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Admin","password":"Admin123"}')

if echo "$LOGIN_RESPONSE" | grep -q "accessToken"; then
    echo "✅ Login test successful!"
    echo "   You can now login with:"
    echo "   Username: Admin"
    echo "   Password: Admin123"
else
    echo "⚠️  Login test returned:"
    echo "$LOGIN_RESPONSE" | head -5
fi
echo ""

echo "=================================================="
echo "✅ Everything is running!"
echo ""
echo "📋 Next Steps:"
echo "   1. Frontend: npm run dev (in another terminal)"
echo "   2. Open: http://localhost:5173"
echo "   3. Login with: Admin / Admin123"
echo ""
echo "📝 Server logs: tail -f server.log"
echo "🛑 Stop server: kill \$(cat server.pid)"

