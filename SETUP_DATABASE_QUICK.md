# 🚀 Quick Setup: Vercel Postgres Database

## Fast 5-Step Setup

### Step 1: Create Database on Vercel

1. Go to: https://vercel.com/dashboard
2. Select your project
3. Click **"Storage"** tab → **"Create Database"**
4. Choose **"Postgres"**
5. Name: `dubai-logistics-db`
6. Click **"Create"**
7. **Copy the connection string** (you'll need it!)

---

### Step 2: Add Environment Variables

1. Project → **"Settings"** → **"Environment Variables"**

2. Add these variables:

   **DATABASE_URL** (REQUIRED):
   ```
   (paste your connection string from Step 1)
   ```

   **Generate secrets:**
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Add:
   - `JWT_SECRET` = (paste generated secret)
   - `JWT_REFRESH_SECRET` = (paste generated secret)  
   - `SESSION_SECRET` = (paste generated secret)

---

### Step 3: Run Migrations

**Option A: Via Vercel Dashboard (Easiest)**

1. Storage → Your Database → **"Query"** tab
2. Open `db/migrations/001_create_drivers_and_locations.sql`
3. Copy all SQL content
4. Paste in Query editor
5. Click **"Run"**

**Option B: Via Command Line**

```bash
# Set DATABASE_URL
export DATABASE_URL="your_connection_string_here"

# Run migration
psql $DATABASE_URL -f db/migrations/001_create_drivers_and_locations.sql

# Create users
node src/server/seedUsers.js
```

---

### Step 4: Redeploy

1. Vercel Dashboard → Your Project
2. **"Deployments"** tab
3. Click **"Redeploy"**

---

### Step 5: Verify

1. Visit: `https://your-app.vercel.app/api/health`
   - Should show: `"database": "connected"`

2. Visit: `https://your-app.vercel.app`
   - Login: `Admin` / `Admin123`
   - Should work!

---

## ✅ Done!

Your database is now set up and working on Vercel! 🎉

