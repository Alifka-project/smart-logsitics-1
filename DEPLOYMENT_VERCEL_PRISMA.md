# 🚀 Vercel Deployment with Prisma - Complete Guide

## ✅ Prerequisites

1. **GitHub Repository**: https://github.com/Alifka-project/smart-logsitics-1
2. **Prisma Database**: Connection string ready
3. **Vercel Account**: Connected to GitHub

---

## 📋 Step 1: Set Up Environment Variables in Vercel

1. **Go to Vercel Dashboard**
   - Visit: https://vercel.com/dashboard
   - Select your project: `smart-logsitics-1`

2. **Navigate to Settings**
   - Click **"Settings"** tab
   - Click **"Environment Variables"** in left sidebar

3. **Add Required Variables**

   **DATABASE_URL** (REQUIRED):
   ```
   Key: DATABASE_URL
   Value: postgres://6a81efaf74f4a117a2bd64fd43af9aae5ad5209628abe313dc93933e468e2a64:sk_ayxWM3HTphNUmIhEUYv__@db.prisma.io:5432/postgres?sslmode=require
   Environment: Production, Preview, Development (select all)
   ```

   **Or use Prisma Accelerate** (faster):
   ```
   Key: DATABASE_URL
   Value: prisma+postgres://accelerate.prisma-data.net/?api_key=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   Environment: All
   ```

   **Generate and add secrets:**
   ```bash
   # Run locally to generate secrets
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Add these (run 3 times for 3 different secrets):
   - `JWT_SECRET` = (paste generated secret)
   - `JWT_REFRESH_SECRET` = (paste generated secret)
   - `SESSION_SECRET` = (paste generated secret)
   - Environment: All for each

4. **Save All Variables**
   - Click **"Save"** after adding each variable

---

## 📋 Step 2: Deploy to Vercel

### Option A: Automatic Deployment (If GitHub is Connected)

1. **Push to GitHub** (we'll do this next)
2. **Vercel will auto-deploy**
3. **Wait for build to complete**

### Option B: Manual Deployment

1. **Install Vercel CLI** (if not installed):
   ```bash
   npm install -g vercel
   ```

2. **Login to Vercel**:
   ```bash
   vercel login
   ```

3. **Deploy**:
   ```bash
   cd dubai-logistics-system
   vercel --prod
   ```

---

## 📋 Step 3: Run Database Migrations on Vercel

After deployment, you need to create tables in your Prisma database:

### Option A: Using Vercel CLI (Recommended)

1. **Set DATABASE_URL** (if not set in environment):
   ```bash
   export DATABASE_URL="your_prisma_connection_string"
   ```

2. **Push schema**:
   ```bash
   npx prisma db push
   ```

3. **Generate Prisma Client** (should be done in build, but verify):
   ```bash
   npx prisma generate
   ```

4. **Create users**:
   ```bash
   node src/server/seedUsers.js
   ```

### Option B: Using Prisma Studio (Visual)

1. **Open Prisma Studio**:
   ```bash
   npx prisma studio
   ```

2. **Create tables manually** via SQL:
   - Go to your Prisma database dashboard
   - Run the SQL from `db/migrations/001_create_drivers_and_locations.sql`

---

## 📋 Step 4: Verify Deployment

### 1. Check Health Endpoint

Visit: `https://smart-logsitics-1.vercel.app/api/health`

**Expected Response:**
```json
{
  "ok": true,
  "db": "connected",
  "orm": "prisma",
  "ts": "2024-12-29T..."
}
```

### 2. Test Login

Visit: `https://smart-logsitics-1.vercel.app`

Login with:
- Username: `Admin`
- Password: `Admin123`

Should redirect to `/admin` dashboard if working.

---

## 🔧 Build Configuration

The `package.json` includes:

```json
{
  "scripts": {
    "build": "prisma generate && vite build",
    "postinstall": "prisma generate"
  }
}
```

This ensures Prisma Client is generated:
- ✅ During build (`npm run build`)
- ✅ After install (`npm install`)

---

## 🐛 Troubleshooting

### "Database connection error" on Health Check

**Problem:** DATABASE_URL not set or incorrect

**Solutions:**
1. Check Environment Variables in Vercel
2. Verify DATABASE_URL is set for all environments
3. Ensure connection string is correct (no extra spaces)
4. Redeploy after adding variables

### "Prisma Client not generated"

**Problem:** Build failed or Prisma generate didn't run

**Solutions:**
1. Check build logs in Vercel
2. Ensure `prisma generate` runs in build script
3. Check `package.json` has `"postinstall": "prisma generate"`
4. Redeploy

### "Table does not exist" Errors

**Problem:** Migrations not run

**Solutions:**
1. Run `npx prisma db push` with DATABASE_URL set
2. Or create tables manually via SQL
3. Verify tables exist: `npx prisma studio`

### Login Fails

**Problem:** Users don't exist in database

**Solutions:**
1. Run `node src/server/seedUsers.js` with DATABASE_URL set
2. Create users manually via Prisma Studio
3. Verify users exist in database

### Build Fails with "Cannot find module '@prisma/client'"

**Problem:** Prisma not installed

**Solutions:**
1. Check `package.json` includes `@prisma/client`
2. Run `npm install` locally and commit `package-lock.json`
3. Ensure `node_modules` is not in `.gitignore` (it shouldn't be)

---

## ✅ Deployment Checklist

Before considering deployment complete:

- [ ] Code pushed to GitHub
- [ ] DATABASE_URL environment variable set in Vercel
- [ ] JWT_SECRET environment variable set in Vercel
- [ ] JWT_REFRESH_SECRET environment variable set in Vercel
- [ ] SESSION_SECRET environment variable set in Vercel
- [ ] Vercel deployment successful
- [ ] Database migrations run (`prisma db push`)
- [ ] Prisma Client generated (should be automatic in build)
- [ ] Default users created (`node src/server/seedUsers.js`)
- [ ] Health check returns `"db": "connected"`
- [ ] Login works with Admin/Admin123
- [ ] Can access admin dashboard

---

## 🎉 Success!

Once all steps are complete:

- ✅ Application deployed to Vercel
- ✅ Database connected via Prisma
- ✅ All tables created
- ✅ Users can log in
- ✅ All features work with database

**Your application is now live with Prisma database integration!** 🚀

---

## 📚 Related Documentation

- `PRISMA_QUICK_START.md` - Quick Prisma setup guide
- `PRISMA_MIGRATION.md` - Detailed Prisma migration guide
- `DEPLOY_TO_VERCEL.md` - General Vercel deployment guide

