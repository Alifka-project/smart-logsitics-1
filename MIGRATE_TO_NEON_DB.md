# 🚀 Migrate to Neon DB - Complete Guide

## ✅ Migration Status

**Database:** Neon PostgreSQL  
**Connection:** ✅ Working  
**Tables:** ✅ Created  
**Status:** Ready for production

---

## 📋 Step 1: Update Vercel Environment Variables

### Go to Vercel Dashboard

1. Visit: https://vercel.com/dashboard
2. Select your project: **smart-logistics-1**
3. Navigate to: **Settings** → **Environment Variables**

### Update DATABASE_URL

1. **Find `DATABASE_URL`** in the list
2. **Click to edit** (or create if it doesn't exist)
3. **Replace the value** with:
   ```
   postgresql://neondb_owner:npg_s9NOj2yMKSAB@ep-lively-cherry-ahgahr7x-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```
4. **Select ALL environments:**
   - ✅ Production
   - ✅ Preview
   - ✅ Development
5. **Click Save**

### Optional: Add Unpooled Connection (for migrations)

If you need a direct connection without connection pooling for migrations:

1. **Add new variable:** `DATABASE_URL_UNPOOLED`
2. **Value:**
   ```
   postgresql://neondb_owner:npg_s9NOj2yMKSAB@ep-lively-cherry-ahgahr7x.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```
3. **Select:** All environments
4. **Click Save**

---

## 📋 Step 2: Verify Required Environment Variables

Make sure these are also set in Vercel:

| Variable | Status | Notes |
|----------|--------|-------|
| `DATABASE_URL` | ✅ **UPDATED** | Neon connection string |
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

## 📋 Step 3: Redeploy on Vercel

After updating environment variables:

1. Go to **Deployments** tab
2. Find the latest deployment
3. Click **⋯** (three dots) → **Redeploy**
4. **Important:** Uncheck "Use existing Build Cache" to ensure new env vars are loaded
5. Wait 2-3 minutes for deployment to complete

---

## 📋 Step 4: Verify Migration

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
  "responseTime": "XXXms"
}
```

### Test Login

1. Go to: https://smart-logistics-1.vercel.app/login
2. Try logging in with your credentials
3. Should work without "Server error" message

---

## 🔍 Troubleshooting

### If Health Check Fails

1. **Check Vercel Logs:**
   - Deployments → Latest → **Functions** tab
   - Look for database connection errors

2. **Verify DATABASE_URL:**
   - Make sure it starts with `postgresql://`
   - Check it matches the Neon connection string exactly
   - Ensure `?sslmode=require` is included

3. **Test Connection Locally:**
   ```bash
   cd dubai-logistics-system
   node diagnose-db-issue.js
   ```

### If Tables Are Missing

If you see errors about missing tables:

1. **Run migrations locally** (with DATABASE_URL set to Neon):
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
   - Use real data from your production database

2. **Check JWT secrets:**
   - Make sure `JWT_SECRET` and `JWT_REFRESH_SECRET` are set
   - They should be different random strings

---

## 📊 Neon Database Connection Details

### Connection Strings

**Pooled (Recommended for most uses):**
```
postgresql://neondb_owner:npg_s9NOj2yMKSAB@ep-lively-cherry-ahgahr7x-pooler.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
```

**Unpooled (For migrations):**
```
postgresql://neondb_owner:npg_s9NOj2yMKSAB@ep-lively-cherry-ahgahr7x.c-3.us-east-1.aws.neon.tech/neondb?sslmode=require
```

### Connection Parameters

- **Host (Pooled):** `ep-lively-cherry-ahgahr7x-pooler.c-3.us-east-1.aws.neon.tech`
- **Host (Unpooled):** `ep-lively-cherry-ahgahr7x.c-3.us-east-1.aws.neon.tech`
- **User:** `neondb_owner`
- **Database:** `neondb`
- **SSL:** Required (`sslmode=require`)

---

## ✅ Migration Checklist

- [ ] DATABASE_URL updated in Vercel (Neon connection string)
- [ ] JWT_SECRET is set (generate if missing)
- [ ] JWT_REFRESH_SECRET is set (generate if missing)
- [ ] SESSION_SECRET is set (generate if missing)
- [ ] Redeployed on Vercel (without build cache)
- [ ] Health check returns `{"ok": true, "database": "connected"}`
- [ ] Login page works without errors
- [ ] Can successfully log in

---

## 🎉 Migration Complete!

Once all steps are completed:

✅ Database connection working  
✅ Tables created in Neon  
✅ Application ready for production  
✅ No more Prisma Accelerate plan limit issues

---

## 📝 Notes

- **Neon DB** is a serverless PostgreSQL database
- **Connection pooling** is enabled by default (recommended)
- **SSL is required** for all connections
- **No usage limits** (unlike Prisma Accelerate free tier)
- **Automatic backups** included

---

**Last Updated:** After successful migration to Neon DB

