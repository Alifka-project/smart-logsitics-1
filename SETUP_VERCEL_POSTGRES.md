# 🐘 Setup Vercel Postgres - Step by Step Guide

## ✅ Complete Guide to Set Up PostgreSQL Database on Vercel

---

## 📋 Step 1: Push Code to GitHub (If Not Done)

First, make sure your code is on GitHub:

```bash
cd dubai-logistics-system

# Check git status
git status

# Add and commit all changes
git add .
git commit -m "Database integration mandatory - Ready for Vercel Postgres"

# Push to GitHub
git push origin main
```

---

## 📋 Step 2: Deploy to Vercel (If Not Done)

1. Go to **https://vercel.com/new**
2. Click **"Import Git Repository"**
3. Select your GitHub repository
4. Configure:
   - **Framework Preset:** Other
   - **Root Directory:** `./`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. Click **"Deploy"** (we'll add database next)

Wait for deployment to complete. You'll get a URL like: `https://your-app.vercel.app`

---

## 📋 Step 3: Create Vercel Postgres Database

### Option A: Via Vercel Dashboard (Easiest)

1. **Go to Vercel Dashboard**
   - Visit: https://vercel.com/dashboard
   - Select your project

2. **Navigate to Storage**
   - Click on your project
   - Go to **"Storage"** tab (left sidebar)
   - Click **"Create Database"**

3. **Select Postgres**
   - Choose **"Postgres"** from the list
   - Click **"Continue"**

4. **Configure Database**
   - **Name:** `dubai-logistics-db` (or any name you prefer)
   - **Region:** Choose closest to you (e.g., `us-east-1`, `eu-west-1`)
   - Click **"Create"**

5. **Wait for Database Creation**
   - Vercel will create your Postgres database
   - This takes 1-2 minutes
   - You'll see "Database created successfully"

6. **Get Connection String**
   - After creation, you'll see **"Connection String"**
   - It looks like: `postgres://default:xxxxx@xxxxx.xxxxx.postgres.vercel-storage.com:5432/verceldb`
   - **Copy this connection string** - you'll need it!

---

### Option B: Via Vercel CLI

```bash
# Install Vercel CLI (if not installed)
npm install -g vercel

# Login to Vercel
vercel login

# Create Postgres database
vercel storage create postgres dubai-logistics-db

# Link to your project
vercel link
```

---

## 📋 Step 4: Connect Database to Your Project

1. **In Vercel Dashboard**
   - Go to your project
   - Click **"Settings"** tab
   - Click **"Environment Variables"**

2. **Add DATABASE_URL**
   - **Key:** `DATABASE_URL`
   - **Value:** Paste your connection string from Step 3
   - **Environment:** Select all (Production, Preview, Development)
   - Click **"Save"**

3. **Add Other Required Variables**

   **Generate Secrets:**
   ```bash
   # Generate JWT_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   
   # Generate JWT_REFRESH_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   
   # Generate SESSION_SECRET
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   **Add to Vercel:**
   - `JWT_SECRET` = (paste generated secret)
   - `JWT_REFRESH_SECRET` = (paste generated secret)
   - `SESSION_SECRET` = (paste generated secret)

---

## 📋 Step 5: Run Database Migrations

You need to create the database tables. You have two options:

### Option A: Using Vercel CLI (Recommended)

1. **Install psql** (PostgreSQL client)
   - **Mac:** `brew install postgresql`
   - **Windows:** Download from https://www.postgresql.org/download/windows/
   - **Linux:** `sudo apt-get install postgresql-client`

2. **Get Connection String from Vercel**
   - Go to Storage → Your Database → Settings
   - Copy the connection string

3. **Run Migration**
   ```bash
   cd dubai-logistics-system
   
   # Set connection string (replace with your actual connection string)
   export DATABASE_URL="postgres://default:xxxxx@xxxxx.xxxxx.postgres.vercel-storage.com:5432/verceldb"
   
   # Run migration
   psql $DATABASE_URL -f db/migrations/001_create_drivers_and_locations.sql
   ```

4. **Create Users**
   ```bash
   # Make sure DATABASE_URL is set
   node src/server/seedUsers.js
   ```

### Option B: Using Vercel Dashboard (Easier)

1. **Go to Vercel Dashboard**
   - Storage → Your Database
   - Click **"Query"** tab

2. **Copy Migration SQL**
   - Open `db/migrations/001_create_drivers_and_locations.sql`
   - Copy all the SQL content

3. **Run in Query Tab**
   - Paste the SQL in the Query editor
   - Click **"Run"**
   - Wait for completion

4. **Create Users Manually**
   - You'll need to run the seed script separately
   - Or create users manually via SQL

---

## 📋 Step 6: Redeploy Your Application

After setting up database and environment variables:

1. **Go to Vercel Dashboard**
   - Your project → **"Deployments"** tab
   - Click **"Redeploy"** on the latest deployment
   - Or push a new commit to trigger redeploy

2. **Wait for Deployment**
   - Build will complete in 1-2 minutes
   - New deployment will use the database

---

## 📋 Step 7: Verify Everything Works

### 1. Check Health Endpoint

Visit: `https://your-app.vercel.app/api/health`

Should return:
```json
{
  "ok": true,
  "database": "connected",
  "ts": "2024-12-29T..."
}
```

If you see `"database": "disconnected"`, the DATABASE_URL is not set correctly.

### 2. Test Login

Visit: `https://your-app.vercel.app`

Login with:
- Username: `Admin`
- Password: `Admin123`

Should redirect to dashboard if database is working.

---

## 🐛 Troubleshooting

### "Database connection error"

**Problem:** DATABASE_URL not set or incorrect

**Solution:**
1. Check Environment Variables in Vercel
2. Make sure DATABASE_URL is set for all environments
3. Verify connection string is correct
4. Redeploy after adding variables

### "Relation does not exist" or "table does not exist"

**Problem:** Migrations not run

**Solution:**
1. Run migration SQL in Vercel Query tab
2. Or use psql to run migrations
3. Verify tables exist by running: `SELECT table_name FROM information_schema.tables;`

### "Invalid username or password" on login

**Problem:** Users not created in database

**Solution:**
1. Run `node src/server/seedUsers.js` (with DATABASE_URL set)
2. Or create users manually via SQL
3. Verify users exist: `SELECT * FROM drivers;`

### Health check shows "disconnected"

**Problem:** Database not accessible or DATABASE_URL wrong

**Solution:**
1. Check Vercel Storage dashboard - database should be "Active"
2. Verify DATABASE_URL format is correct
3. Check if database is in the same region
4. Try connecting with psql to verify connection string

---

## ✅ Checklist

- [ ] Code pushed to GitHub
- [ ] Project deployed to Vercel
- [ ] Vercel Postgres database created
- [ ] DATABASE_URL environment variable set
- [ ] JWT_SECRET environment variable set
- [ ] JWT_REFRESH_SECRET environment variable set
- [ ] SESSION_SECRET environment variable set
- [ ] Database migrations run
- [ ] Users created in database
- [ ] Application redeployed
- [ ] Health check shows "database": "connected"
- [ ] Login works

---

## 🎉 Success!

Once all steps are complete:
- ✅ Database is running on Vercel
- ✅ All tables created
- ✅ Users can log in
- ✅ All features work with database

**Your application is now fully deployed with PostgreSQL database!** 🚀

