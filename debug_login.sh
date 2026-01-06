#!/bin/bash
echo "🔍 Testing Login API..."
echo ""
echo "1. Health Check:"
curl -s https://smart-logsitics-1.vercel.app/api/health | jq . || curl -s https://smart-logsitics-1.vercel.app/api/health
echo ""
echo ""
echo "2. Login Test:"
curl -s -X POST https://smart-logsitics-1.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Admin","password":"Admin123"}' | jq . || curl -s -X POST https://smart-logsitics-1.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"Admin","password":"Admin123"}'
echo ""
