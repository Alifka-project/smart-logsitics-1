# 🔍 Database Data Issue - Diagnostic & Fix Guide

## ❌ Issue: Dashboard Shows 0 Deliveries

You're seeing an empty dashboard even though data should exist in the database.

---

## 🔧 Step 1: Diagnose the Problem

### Check if Database Connection Works
```bash
curl https://your-domain.com/api/health
```

**Expected Response:**
```json
{
  "ok": true,
  "database": "connected",
  "orm": "prisma"
}
```

If this fails → **Database connection issue** (go to Step 2)

### Check if Data Exists in Database
```bash
curl https://your-domain.com/api/diag/status
```

**Expected Response:**
```json
{
  "ok": true,
  "data": {
    "deliveries": 50,        // Should be > 0
    "drivers": 2,
    "assignments": 10,
    "sampleDelivery": {...}
  }
}
```

**Possible Issues:**

| Response | Problem | Solution |
|----------|---------|----------|
| `"deliveries": 0` | No data in database | Upload deliveries or restore backup |
| `connection_error` | Can't connect to DB | Check DATABASE_URL env var |
| `prisma_error` | Prisma not working | Check migrations and schema |

---

## 🔧 Step 2: Fix Database Connection Issues

### Check Environment Variables

Your app needs this to connect:
```
DATABASE_URL=postgresql://user:password@host:port/database
```

**How to verify in Vercel:**
1. Go to: **Vercel Dashboard → Project → Settings → Environment Variables**
2. Look for `DATABASE_URL`
3. If missing → Add it
4. Click "Redeploy" to apply changes

### Common DATABASE_URL Formats

**Vercel Postgres:**
```
postgresql://user:xxxx@host.postgres.vercel.com:5432/db
```

**AWS RDS:**
```
postgresql://admin:password@db-instance.region.rds.amazonaws.com:5432/dbname
```

**DigitalOcean:**
```
postgresql://doadmin:password@db-host-region.db.ondigitalocean.com:25060/dbname?sslmode=require
```

### Test Connection Locally
```bash
psql postgresql://user:password@host:port/database -c "SELECT COUNT(*) FROM deliveries;"
```

---

## 🔧 Step 3: Restore or Re-upload Data

### Option A: Data Still Exists (Connection Issue)
If `/api/diag/status` shows deliveries > 0:
1. Wait 5 minutes (Vercel might be caching)
2. Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)
3. Clear localStorage: Open DevTools → Application → Storage → Clear All
4. Refresh page

### Option B: Database is Empty (Need to Re-add Data)

**If you have a backup database:**
```bash
# Restore from backup
psql database_url < backup.sql
```

**If you need to re-upload deliveries:**
1. Go to: https://your-domain.com/deliveries
2. Login as admin
3. Click "Upload File"
4. Upload your CSV with delivery data
5. OR click "Generate Synthetic Data" to test

**To populate SMS data:**
1. Navigate to deliveries
2. Click blue "SMS" button on any delivery
3. Click "Send SMS"
4. This creates SMS logs in database

---

## 🔧 Step 4: Common Fixes

### Issue: Empty Dashboard After Deployment

**Solution:**
1. Verify `DATABASE_URL` is set in Vercel
2. Check `/api/diag/status` endpoint
3. If deliveries = 0, upload new data
4. Hard refresh browser

### Issue: Data Shows in `/api/diag/status` But Not on Dashboard

**Solution:**
1. The dashboard might be using cached data
2. Clear browser cache:
   - Open DevTools
   - Storage → Clear All
   - Hard Refresh (Ctrl+Shift+R)
3. Check browser console for errors
4. Manually call endpoint: `curl https://your-domain.com/api/deliveries`

### Issue: `/api/health` Shows Error

**Solutions:**

**"DATABASE_URL not set"**
```
Fix: Add DATABASE_URL to Vercel environment variables
```

**"Connection refused"**
```
Fix: Check if database is running
    Verify DATABASE_URL is correct
    Check firewall/security groups allow connection
```

**"Too many connections"**
```
Fix: Database connection pool exhausted
     Increase pool size or restart connections
```

---

## 🧪 Testing Checklist

After each fix, test:

- [ ] `curl /api/health` → Returns `"ok": true`
- [ ] `curl /api/diag/status` → Shows data counts
- [ ] Dashboard loads without errors
- [ ] Delivery count > 0
- [ ] Admin dashboard shows data
- [ ] Can see deliveries in list
- [ ] SMS button appears on deliveries
- [ ] Can send SMS and get link

---

## 📋 Data Path Through System

```
Database (PostgreSQL)
    ↓
Prisma ORM
    ↓
API Endpoints:
  - /api/deliveries
  - /api/admin/dashboard
  - /api/admin/tracking/deliveries
    ↓
Frontend Store (Zustand)
    ↓
Dashboard Page
```

If any layer breaks → data won't show.

---

## 🔍 Debug Endpoints Available

### Public (No Auth Required)
```
GET /api/health               → Check database connection
GET /api/diag/status          → Check data and counts
```

### Protected (Admin Only)
```
GET /api/deliveries           → Get all deliveries
GET /api/admin/dashboard      → Get dashboard metrics
GET /api/admin/tracking/deliveries → Get tracking data
```

---

## 💾 Database Backup & Restore

### Create Backup
```bash
pg_dump postgresql://user:pass@host:port/database > backup.sql
```

### Restore Backup
```bash
psql postgresql://user:pass@host:port/database < backup.sql
```

### Check Table Sizes
```bash
psql DATABASE_URL -c "
SELECT schemaname, tablename, 
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename))
FROM pg_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;"
```

---

## 🚀 What Should Happen

### Working Flow:
1. **User visits dashboard** → `/api/health` called automatically
2. **Dashboard loads** → Calls `/api/admin/dashboard` and `/api/admin/tracking/deliveries`
3. **Data displayed** → Shows:
   - Total Deliveries: > 0
   - Delivered: count
   - Pending: count
   - Active Drivers: count
   - Charts with data

### Broken Flow:
1. **User visits dashboard** → API call fails silently
2. **Dashboard shows 0** → No error message (bad UX!)
3. **Data not loaded** → Empty state displayed

---

## ✅ What I've Added

### New Diagnostic Tools:
- ✅ `/api/diag/status` endpoint for debugging
- ✅ Better error messages
- ✅ Database connection verification
- ✅ Data count checks

### Next: Data Recovery

I need to know:
1. **When did it last work?** (Before my update? Before deployment?)
2. **Do you have database backup?** (If yes, I can help restore)
3. **Do you have the uploaded CSV files?** (Can re-upload)
4. **Is the database empty or just the API failing?** (Check `/api/diag/status`)

---

## 🆘 If All Else Fails

**Nuclear Option - Reset Database:**
```bash
# Run Prisma migrations again
npx prisma migrate deploy

# Re-upload all your data
# Go to: https://your-domain.com/deliveries
# Click "Upload File"
```

---

**Let me know:**
1. What does `/api/diag/status` return?
2. When did data last show correctly?
3. Do you have a database backup I can restore?

I'll fix this! 💪
