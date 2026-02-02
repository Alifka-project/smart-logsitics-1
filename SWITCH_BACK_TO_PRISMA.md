# ✅ Switch Back to Prisma - Complete Guide

## ✅ Status: Prisma Connection Working

**Database:** Prisma Cloud (db.prisma.io)  
**Connection:** ✅ Working  
**Tables:** ✅ 11 tables found  
**Data:** ✅ 3 drivers, 3 accounts, 102 deliveries  
**Status:** Ready for production

---

## 📋 Prisma Connection Details

### Connection String

```
postgres://6a81efaf74f4a117a2bd64fd43af9aae5ad5209628abe313dc93933e468e2a64:sk_ayxWM3HTphNUmIhEUYv__@db.prisma.io:5432/postgres?sslmode=require
```

### Optional: Prisma Accelerate (Faster - Connection Pooling)

If you want to use Prisma Accelerate for better performance:

```
PRISMA_DATABASE_URL=prisma+postgres://accelerate.prisma-data.net/?api_key=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqd3RfaWQiOjEsInNlY3VyZV9rZXkiOiJza19heXhXTTNIVHBoTlVtSWhFVVl2X18iLCJhcGlfa2V5IjoiMDFLRE5EWkZLMlBIQjFDRVFTWTI0RkZHS1EiLCJ0ZW5hbnRfaWQiOiI2YTgxZWZhZjc0ZjRhMTE3YTJiZDY0ZmQ0M2FmOWFhZTVhZDUyMDk2MjhhYmUzMTNkYzkzOTMzZTQ2OGUyYTY0IiwiaW50ZXJuYWxfc2VjcmV0IjoiMjY5N2I0MTgtNjY3My00MTliLTg0MGItMmY5OTY0MjFjZGY4In0.NLASl9RPSF7AfCrAhF1PZ4XvRZ9eA5Oh4mQZKXgcynQ
```

**Note:** Prisma Accelerate requires an active Prisma account and may have usage limits.

---

## 🔧 Step 1: Update Vercel Environment Variables

### Go to Vercel Dashboard

1. Visit: https://vercel.com/dashboard
2. Select your project: **smart-logistics-1** (or **electrolux-smart-portal**)
3. Navigate to: **Settings** → **Environment Variables**

### Update DATABASE_URL

1. **Find `DATABASE_URL`** in the list
2. **Click to edit** (or create if it doesn't exist)
3. **Replace the value** with:
   ```
   postgres://6a81efaf74f4a117a2bd64fd43af9aae5ad5209628abe313dc93933e468e2a64:sk_ayxWM3HTphNUmIhEUYv__@db.prisma.io:5432/postgres?sslmode=require
   ```
4. **Select ALL environments:**
   - ✅ Production
   - ✅ Preview
   - ✅ Development
5. **Click Save**

### Optional: Add PRISMA_DATABASE_URL (for Accelerate)

If you want to use Prisma Accelerate:

1. **Add new variable:** `PRISMA_DATABASE_URL`
2. **Value:**
   ```
   prisma+postgres://accelerate.prisma-data.net/?api_key=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqd3RfaWQiOjEsInNlY3VyZV9rZXkiOiJza19heXhXTTNIVHBoTlVtSWhFVVl2X18iLCJhcGlfa2V5IjoiMDFLRE5EWkZLMlBIQjFDRVFTWTI0RkZHS1EiLCJ0ZW5hbnRfaWQiOiI2YTgxZWZhZjc0ZjRhMTE3YTJiZDY0ZmQ0M2FmOWFhZTVhZDUyMDk2MjhhYmUzMTNkYzkzOTMzZTQ2OGUyYTY0IiwiaW50ZXJuYWxfc2VjcmV0IjoiMjY5N2I0MTgtNjY3My00MTliLTg0MGItMmY5OTY0MjFjZGY4In0.NLASl9RPSF7AfCrAhF1PZ4XvRZ9eA5Oh4mQZKXgcynQ
   ```
3. **Select:** All environments
4. **Click Save**

---

## 🔧 Step 2: Verify Required Environment Variables

Make sure these are also set in Vercel:

| Variable | Status | Notes |
|----------|--------|-------|
| `DATABASE_URL` | ✅ **UPDATED** | Prisma connection string |
| `JWT_SECRET` | ⚠️ Check | Generate if missing |
| `JWT_REFRESH_SECRET` | ⚠️ Check | Generate if missing |
| `SESSION_SECRET` | ⚠️ Check | Generate if missing |
| `NODE_ENV` | ✅ Set | Should be `production` |

### Generate JWT Secrets (if needed)

Run these commands locally to generate secure secrets:

```bash
# Generate JWT_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate JWT_REFRESH_SECRET (run again for different value)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate SESSION_SECRET (run again for different value)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Add each generated value to Vercel Environment Variables.

---

## 🔧 Step 3: Redeploy on Vercel

After updating environment variables:

1. Go to **Deployments** tab
2. Find the latest deployment
3. Click **⋯** (three dots) → **Redeploy**
4. **Important:** Uncheck "Use existing Build Cache"
5. Wait 2-3 minutes for deployment to complete

---

## 🔧 Step 4: Verify Migration

### Test Health Endpoint

```bash
curl https://electrolux-smart-portal.vercel.app/api/health
```

**Expected Response:**
```json
{
  "ok": true,
  "database": "connected",
  "orm": "prisma",
  "responseTime": "XXXms"
}
```

### Test Diagnostic Endpoint

```bash
curl https://electrolux-smart-portal.vercel.app/api/diag/status
```

**Expected Response:**
```json
{
  "ok": true,
  "database": "connected",
  "data": {
    "deliveries": 102,
    "drivers": 3,
    "accounts": 3,
    ...
  }
}
```

### Test Login

1. Go to: https://electrolux-smart-portal.vercel.app/login
2. Try logging in with your credentials
3. Should work without "Server error" message

---

## 🔍 Troubleshooting

### If Health Check Fails

1. **Check Vercel Logs:**
   - Deployments → Latest → **Functions** tab
   - Look for database connection errors

2. **Verify DATABASE_URL:**
   - Make sure it starts with `postgres://` or `postgresql://`
   - Check it matches the Prisma connection string exactly
   - Ensure `?sslmode=require` is included

3. **Test Connection Locally:**
   ```bash
   cd dubai-logistics-system
   node diagnose-db-issue.js
   ```

### If Tables Are Missing

If you see errors about missing tables:

1. **Run migrations locally** (with DATABASE_URL set to Prisma):
   ```bash
   npx prisma db push
   ```

2. **Or use Prisma Migrate:**
   ```bash
   npx prisma migrate deploy
   ```

### If Login Still Fails

1. **Check if users exist:**
   - You may need to create users in the database
   - Run: `node create-users-prisma.js` (if available)

2. **Check JWT secrets:**
   - Make sure `JWT_SECRET` and `JWT_REFRESH_SECRET` are set
   - They should be different random strings

### Prisma Accelerate Plan Limit

If you get an error about plan limits:

1. **Option 1:** Upgrade your Prisma Accelerate plan
   - Go to: https://console.prisma.io/
   - Navigate to your project
   - Upgrade plan

2. **Option 2:** Use direct Prisma connection (DATABASE_URL)
   - This doesn't require Accelerate
   - No usage limits
   - Slightly slower but more reliable

---

## 📊 Prisma Database Connection Details

### Connection String Format

**Direct Connection:**
```
postgres://user:password@db.prisma.io:5432/postgres?sslmode=require
```

**Prisma Accelerate (Optional):**
```
prisma+postgres://accelerate.prisma-data.net/?api_key=YOUR_API_KEY
```

### Connection Parameters

- **Host:** `db.prisma.io`
- **Port:** `5432`
- **Database:** `postgres`
- **SSL:** Required (`sslmode=require`)

---

## ✅ Migration Checklist

- [ ] DATABASE_URL updated in Vercel (Prisma connection string)
- [ ] JWT_SECRET is set (generate if missing)
- [ ] JWT_REFRESH_SECRET is set (generate if missing)
- [ ] SESSION_SECRET is set (generate if missing)
- [ ] Redeployed on Vercel (without build cache)
- [ ] Health check returns `{"ok": true, "database": "connected"}`
- [ ] Diagnostic endpoint returns data counts
- [ ] Login page works without errors
- [ ] Can successfully log in
- [ ] Dashboard loads without errors

---

## 🎉 Migration Complete!

Once all steps are completed:

✅ Database connection working  
✅ Tables exist in Prisma database  
✅ Application ready for production  
✅ Using Prisma Cloud database

---

## 📝 Notes

- **Prisma Cloud** is Prisma's managed database service
- **Direct connection** (`DATABASE_URL`) - No usage limits, reliable
- **Prisma Accelerate** (`PRISMA_DATABASE_URL`) - Faster with connection pooling, but may have usage limits
- **SSL is required** for all connections
- **Automatic backups** included with Prisma Cloud

---

## 🔄 Switching Between Prisma and Neon

If you need to switch back to Neon in the future:

1. Update `DATABASE_URL` in Vercel to Neon connection string
2. Redeploy
3. That's it! The code works with both Prisma and Neon

---

**Last Updated:** After switching back to Prisma database

