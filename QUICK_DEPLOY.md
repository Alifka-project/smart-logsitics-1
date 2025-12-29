# 🚀 Quick Deploy to Vercel

## Fast 5-Step Deployment

### 1. Push to GitHub

```bash
cd dubai-logistics-system

# If git not initialized:
git init
git add .
git commit -m "Initial commit"

# Add GitHub remote (replace with your repo URL):
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git
git branch -M main
git push -u origin main
```

### 2. Deploy to Vercel

1. Go to: https://vercel.com/new
2. Click **"Import Git Repository"**
3. Select your GitHub repo
4. Click **"Deploy"** (uses default settings)

### 3. Set Up Database (MANDATORY)

**⚠️ Database is REQUIRED. You MUST set up PostgreSQL database.**

**Option A: Vercel Postgres (Easiest)**
1. Vercel Dashboard → Storage → Create Database → Postgres
2. Copy connection string

**Option B: External (Supabase/Railway/Neon)**
1. Create PostgreSQL database
2. Copy connection string

### 4. Add Environment Variables

In Vercel dashboard → Your Project → Settings → Environment Variables:

**MANDATORY (Database Required):**
```
DATABASE_URL=your_postgres_connection_string  # REQUIRED - System won't work without this
JWT_SECRET=your_random_secret_key_here
JWT_REFRESH_SECRET=your_random_refresh_secret
SESSION_SECRET=your_random_session_secret
```

**⚠️ DATABASE_URL is MANDATORY. Without it, login and all features will fail.**

**Generate secrets:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Run migrations (MANDATORY):**
```bash
# Connect to production DB and run:
psql $DATABASE_URL -f db/migrations/001_create_drivers_and_locations.sql
node src/server/seedUsers.js  # (set DATABASE_URL first)
```

**⚠️ Without running migrations and creating users, login will fail.**

### 5. Redeploy

After adding environment variables:
1. Go to Vercel Dashboard
2. Click **"Redeploy"**
3. Wait for deployment to complete

**Done!** Your app is live at `https://your-app.vercel.app`

---

## ✅ Verify It Works

1. Visit: `https://your-app.vercel.app/api/health`
   - Should return: `{"ok":true}`

2. Visit: `https://your-app.vercel.app`
   - Should show login page

3. Login: `Admin` / `Admin123`
   - Should work!

---

## 🐛 Issues?

- **401 Error:** Check `JWT_SECRET` is set
- **Database Error:** Check `DATABASE_URL` is correct
- **CORS Error:** Add Vercel domain to allowed origins

See `DEPLOY_TO_VERCEL.md` for detailed guide.

