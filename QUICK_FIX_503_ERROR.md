# 🚨 Quick Fix: 503 Service Unavailable on Login

## The Problem
```
POST /api/auth/login → 503 Service Unavailable
```

**Cause**: `DATABASE_URL` is not set on Vercel

---

## The Fix (5 Minutes)

### Step 1: Go to Vercel Dashboard
```
https://vercel.com/dashboard
```

### Step 2: Select Your Project
- Click: **smart-logistics-1**

### Step 3: Open Environment Variables
- Click: **Settings**
- Click: **Environment Variables**

### Step 4: Add DATABASE_URL

**Look for** `DATABASE_URL` in the list:

- ✅ **If it exists**: Check if value looks like `postgresql://...`
  - If it starts with `postgres://` (old format), it might be wrong
  - Update it to the new format with `postgresql://`

- ❌ **If it doesn't exist**: Click **Add New** and fill in:
  - **Name**: `DATABASE_URL`
  - **Value**: (paste your PostgreSQL connection string)
  - **Environment**: Check Production, Preview, Development

### Step 5: Redeploy
- Go to: **Deployments** tab
- Find latest deployment
- Click: **Redeploy**
- Wait 2-3 minutes

### Step 6: Test
1. Visit: https://smart-logistics-1.vercel.app/login
2. Try logging in
3. Should work now ✅

---

## DATABASE_URL Format

### Vercel Postgres
```
postgresql://default:PASSWORD@aws-0-us-east-1.postgres.vercel-storage.com:5432/verceldb?sslmode=require
```

### Railway
```
postgresql://user:password@containers-us-west-123.railway.app:5432/railway
```

### Heroku
```
postgresql://user:password@ec2-xxx-us-east-1.compute.amazonaws.com:5432/dbname?sslmode=require
```

### AWS RDS
```
postgresql://admin:password@mydb.abc123.us-east-1.rds.amazonaws.com:5432/mydb?sslmode=require
```

---

## Verify It Works

After setting DATABASE_URL and redeploying:

```bash
# Test health endpoint
curl https://smart-logistics-1.vercel.app/api/health

# Should return:
# {"ok":true,"database":"connected","orm":"prisma",...}
```

---

## Still Getting 503?

### Check 1: Verify DATABASE_URL
1. Go back to **Environment Variables**
2. Make sure `DATABASE_URL` is visible
3. Click the eye icon to see the first few characters
4. Should start with `postgresql://`

### Check 2: Test Connection String Locally
```bash
# Replace with your DATABASE_URL
psql "YOUR_DATABASE_URL" -c "SELECT 1"
```

If this fails locally, your DATABASE_URL is wrong.

### Check 3: Check Vercel Logs
1. Go to **Deployments** → Latest
2. Click **Logs (Runtime)**
3. Look for errors mentioning database

### Check 4: Redeploy Without Cache
1. Go to **Deployments** → Latest
2. Click **...** (three dots)
3. Click **Redeploy**
4. Choose "Use existing Build Cache": **NO**

---

## Need a Database?

If you don't have a PostgreSQL database yet:

### Easiest: Vercel Postgres (2 min setup)
1. Go to: https://vercel.com/docs/storage/vercel-postgres
2. Click **Create Database**
3. Vercel auto-fills DATABASE_URL ✅

### Alternative Options:
- **Railway**: https://railway.app (free tier available)
- **Heroku Postgres**: https://www.heroku.com/ (paid)
- **Render**: https://render.com (free tier)
- **PlanetScale**: https://planetscale.com (MySQL)

---

## Success Signs

After fix is applied:

✅ Health check returns `{"ok":true,"database":"connected"}`  
✅ Login page doesn't show error  
✅ Can log in with valid credentials  
✅ Dashboard loads after login  

---

**That's it! Set DATABASE_URL on Vercel and redeploy. Should be fixed in 5 minutes!** 🚀
