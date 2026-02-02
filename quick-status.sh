#!/bin/bash

# Quick System Status Check Script
# Usage: ./quick-status.sh

echo "╔═══════════════════════════════════════════════════════════╗"
echo "║         🚀 Smart Logistics - Quick Status Check          ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

# Check Database
echo "🗄️  Checking Database..."
if docker ps | grep -q "smart-logsitics-1-db-1"; then
    echo "   ✅ Database container is running"
else
    echo "   ❌ Database container is NOT running"
    echo "   💡 Start it with: docker-compose up -d db"
fi

# Check Backend
echo ""
echo "🔧 Checking Backend Server..."
if lsof -Pi :4000 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "   ✅ Backend server is running on port 4000"
else
    echo "   ❌ Backend server is NOT running"
    echo "   💡 Start it with: npm run dev:backend"
fi

# Check Frontend
echo ""
echo "⚛️  Checking Frontend Server..."
if lsof -Pi :5173 -sTCP:LISTEN -t >/dev/null 2>&1; then
    echo "   ✅ Frontend server is running on port 5173"
else
    echo "   ❌ Frontend server is NOT running"
    echo "   💡 Start it with: npm run dev:frontend"
fi

# Test Database Connection
echo ""
echo "🔌 Testing Database Connection..."
if command -v psql >/dev/null 2>&1; then
    if PGPASSWORD=postgres psql -h localhost -U postgres -d postgres -c "SELECT 1" >/dev/null 2>&1; then
        echo "   ✅ Database connection successful"
    else
        echo "   ⚠️  Cannot connect to database"
    fi
else
    echo "   ℹ️  psql not installed, skipping connection test"
fi

# Summary
echo ""
echo "═══════════════════════════════════════════════════════════"
echo "📊 System URLs:"
echo "   Frontend:  http://localhost:5173"
echo "   Backend:   http://localhost:4000"
echo "   Database:  localhost:5432"
echo ""
echo "🔐 Login Credentials:"
echo "   Username: admin"
echo "   Password: admin123"
echo "═══════════════════════════════════════════════════════════"
echo ""
