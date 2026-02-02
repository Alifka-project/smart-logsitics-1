# 🔍 Database Connection Debugging Guide

## ❌ Issue: Dashboard Shows "Failed to fetch dashboard data"

The dashboard is failing to load because the database connection is not working on Vercel.

---

## ✅ What I've Fixed

### 1. Enhanced Error Handling in Dashboard API
- Added Prisma client initialization check
- Added database connection test before queries
- Better error messages with specific error codes
- Graceful fallback when database is unavailable

### 2. Improved Prisma Initialization
- Better logging of connection issues
- More detailed error messages
- Handles null Prisma client gracefully

### 3. Enhanced Diagnostic Endpoint
- `/api/diag/status` now checks Prisma initialization
- Tests connection before querying data
- Returns specific error codes

---

## 🔧 Step 1: Verify Vercel Environment Variables

**The main issue is likely that Vercel still has the old DATABASE_URL.**

### Check Vercel Settings

1. Go to: https://vercel.com/dashboard
2. Select: **smart-logistics-1** project
3. Navigate: **Settings** → **Environment Variables**
4. Find: `DATABASE_URL`

### Update DATABASE_URL

**Current (OLD - Prisma Accelerate):**
```
postgres://6a81efaf74f4a117a2bd64fd43af9aae5ad5209628abe313dc93933e468e2a64:sk_ayxWM3HTphNUmIhEUYv__@db.prisma.io:5432/postgres?sslmode=require
```

**New (Neon DB):**
```
postgresql://neondb_owner:npg_s9NOj2yMKSAB@ep-lively-cherry-ahgahr7x-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
```

### Steps to Update

1. Click on `DATABASE_URL` to edit
2. Replace the entire value with the Neon connection string above
3. **Select ALL environments:**
   - ✅ Production
   - ✅ Preview  
   - ✅ Development
4. Click **Save**
5. **Redeploy** (see Step 2)

---

## 🔧 Step 2: Redeploy on Vercel

After updating environment variables:

1. Go to **Deployments** tab
2. Find the latest deployment
3. Click **⋯** (three dots) → **Redeploy**
4. **IMPORTANT:** Uncheck "Use existing Build Cache"
5. Wait 2-3 minutes for deployment

---

## 🔧 Step 3: Test the Connection

### Test Health Endpoint

```bash
curl https://smart-logistics-1.vercel.app/api/health
```

**Expected Response:**
```json
{
  "ok": true,
  "database": "connected",
  "orm": "prisma",
  "ts": "2026-02-02T..."
}
```

**If it fails:**
```json
{
  "ok": false,
  "database": "disconnected",
  "error": "Can't reach database server",
  "ts": "2026-02-02T..."
}
```

### Test Diagnostic Endpoint

```bash
curl https://smart-logistics-1.vercel.app/api/diag/status
```

**Expected Response:**
```json
{
  "ok": true,
  "database": "connected",
  "data": {
    "deliveries": 15,
    "drivers": 2,
    "assignments": 10,
    ...
  }
}
```

---

## 🔍 Step 4: Check Vercel Logs

If the connection still fails:

1. Go to **Deployments** → Latest deployment
2. Click **Functions** tab
3. Look for errors containing:
   - `Prisma Init`
   - `DATABASE_URL`
   - `connection`
   - `P1001` (connection error code)

### Common Error Messages

| Error | Meaning | Solution |
|-------|---------|----------|
| `DATABASE_URL not set` | Environment variable missing | Add DATABASE_URL in Vercel |
| `Prisma not initialized` | Prisma client creation failed | Check DATABASE_URL format |
| `P1001: Can't reach database server` | Connection timeout | Check connection string |
| `P2021: Table does not exist` | Schema not migrated | Run `npx prisma db push` |

---

## 🔧 Step 5: Verify Connection String Format

The Neon connection string should be:

```
postgresql://neondb_owner:npg_s9NOj2yMKSAB@ep-lively-cherry-ahgahr7x-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
```

**Important:**
- ✅ Starts with `postgresql://` (not `postgres://`)
- ✅ Includes `?sslmode=require`
- ✅ Uses pooled connection (`-pooler` in hostname)
- ✅ No extra spaces or quotes

---

## 🔧 Step 6: Test Locally First

Before deploying to Vercel, test locally:

```bash
cd dubai-logistics-system
node diagnose-db-issue.js
```

**Expected Output:**
```
✅ Database connection successful!
✅ Found 11 tables in database
✅ Data query successful
```

If this works locally but fails on Vercel → **Environment variable issue**

---

## 📋 Debugging Checklist

- [ ] DATABASE_URL updated in Vercel (Neon connection string)
- [ ] All environments selected (Production, Preview, Development)
- [ ] Redeployed without build cache
- [ ] `/api/health` returns `{"ok": true, "database": "connected"}`
- [ ] `/api/diag/status` returns data counts
- [ ] Dashboard loads without "Failed to fetch" error
- [ ] Can see deliveries in dashboard

---

## 🚨 If Still Not Working

### Check Vercel Function Logs

1. Go to **Deployments** → Latest
2. Click **Functions** → Find `/api/admin/dashboard`
3. Look for:
   ```
   [Prisma Init] Starting initialization...
   [Prisma Init] DATABASE_URL is SET (length: XXX)
   [Dashboard] Database connection verified
   ```

### Common Issues

1. **DATABASE_URL not updated**
   - Solution: Update in Vercel and redeploy

2. **Connection string format wrong**
   - Solution: Copy exact string from Neon dashboard

3. **Tables missing**
   - Solution: Run `npx prisma db push` locally with Neon DATABASE_URL

4. **SSL certificate issue**
   - Solution: Ensure `?sslmode=require` is in connection string

---

## ✅ Success Indicators

When everything is working:

1. ✅ `/api/health` → `{"ok": true, "database": "connected"}`
2. ✅ `/api/diag/status` → Returns data counts
3. ✅ Dashboard loads without errors
4. ✅ Can see deliveries, drivers, and metrics
5. ✅ No "Failed to fetch dashboard data" message

---

## 📝 Summary

**The main issue:** Vercel is still using the old Prisma Accelerate DATABASE_URL instead of the new Neon DB connection string.

**The fix:** Update DATABASE_URL in Vercel environment variables to the Neon connection string and redeploy.

**Files updated:**
- `src/server/api/adminDashboard.js` - Better error handling
- `src/server/db/prisma.js` - Improved initialization logging
- `api/index.js` - Enhanced diagnostic endpoint

---

**Last Updated:** After adding database connection debugging improvements

