# 🚀 Deploy to Vercel - Complete Guide

## 📋 Prerequisites

1. **GitHub account** (if not already set up)
2. **Vercel account** (sign up at https://vercel.com - free tier available)
3. **Git repository** initialized

---

## ✅ Step 1: Initialize Git Repository (if not done)

```bash
cd dubai-logistics-system

# Initialize git (if not already done)
git init

# Add all files
git add .

# Create initial commit
git commit -m "Initial commit: Dubai Logistics System"
```

---

## ✅ Step 2: Create GitHub Repository

1. Go to https://github.com/new
2. Create a new repository (e.g., `dubai-logistics-system`)
3. **Don't** initialize with README, .gitignore, or license
4. Copy the repository URL

---

## ✅ Step 3: Push to GitHub

```bash
# Add GitHub remote (replace YOUR_USERNAME and REPO_NAME)
git remote add origin https://github.com/YOUR_USERNAME/REPO_NAME.git

# Push to GitHub
git branch -M main
git push -u origin main
```

---

## ✅ Step 4: Set Up Environment Variables

**⚠️ DATABASE IS MANDATORY - You MUST set up database before deployment**

Before deploying, you need to set up environment variables in Vercel:

**MANDATORY Environment Variables (Database Required):**
- `DATABASE_URL` - **REQUIRED** - Your PostgreSQL connection string (MANDATORY - System won't work without this)
- `JWT_SECRET` - Secret key for JWT tokens (generate a random string)
- `JWT_REFRESH_SECRET` - Secret key for refresh tokens
- `SESSION_SECRET` - Secret for session management

**Optional (but recommended):**
- `CORS_ORIGINS` - Comma-separated list of allowed origins
- `ENFORCE_HTTPS` - Set to `1` to enforce HTTPS

**⚠️ Without DATABASE_URL, the system will NOT work. Database integration is mandatory.**

---

## ✅ Step 5: Deploy to Vercel

### Option A: Using Vercel CLI (Recommended)

```bash
# Install Vercel CLI globally
npm install -g vercel

# Login to Vercel
vercel login

# Deploy (from project directory)
cd dubai-logistics-system
vercel

# Follow the prompts:
# - Set up and deploy? Yes
# - Which scope? (select your account)
# - Link to existing project? No
# - Project name? (press Enter for default or enter custom name)
# - Directory? ./
# - Override settings? No

# For production deployment:
vercel --prod
```

### Option B: Using Vercel Dashboard (Easier)

1. Go to https://vercel.com/new
2. Click **"Import Git Repository"**
3. Select your GitHub repository
4. Configure project:
   - **Framework Preset:** Other
   - **Root Directory:** `./`
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
5. **Add Environment Variables:**
   - Click "Environment Variables"
   - Add all required variables (see Step 4)
6. Click **"Deploy"**

---

## ✅ Step 6: Configure Vercel for Backend API

The project is configured with:
- `vercel.json` - Routes API requests to serverless function
- `api/index.js` - Serverless function entry point

Vercel will automatically:
- Deploy frontend (static files from `dist/`)
- Deploy backend as serverless function (`/api/*` routes)

---

## ✅ Step 7: Set Up Database (Production)

For production, you need a PostgreSQL database. Options:

### Option A: Vercel Postgres (Recommended)
1. In Vercel dashboard, go to your project
2. Click **"Storage"** tab
3. Click **"Create Database"** → **"Postgres"**
4. Copy the connection string
5. Add as `DATABASE_URL` environment variable

### Option B: External Database (Supabase, Railway, etc.)
1. Create PostgreSQL database (e.g., Supabase, Railway, Neon)
2. Copy connection string
3. Add as `DATABASE_URL` in Vercel environment variables

### Run Migrations
After setting up database, run migrations:
```bash
# Connect to your production database and run:
psql $DATABASE_URL -f db/migrations/001_create_drivers_and_locations.sql
```

### Create Users
```bash
# Set DATABASE_URL environment variable, then:
node src/server/seedUsers.js
```

---

## ✅ Step 8: Update Frontend API URL

After deployment, update your frontend to use the production API:

**Option 1: Environment Variable**
```bash
# In Vercel, add environment variable:
VITE_API_BASE=https://your-app.vercel.app/api
```

**Option 2: Update vite.config.js**
Or update the proxy in development to point to production API.

---

## ✅ Step 9: Verify Deployment

1. **Check Frontend:**
   - Visit: `https://your-app.vercel.app`
   - Should show login page

2. **Check Backend Health:**
   - Visit: `https://your-app.vercel.app/api/health`
   - Should return: `{"ok":true,"ts":"..."}`

3. **Test Login:**
   - Use credentials: `Admin` / `Admin123`
   - Should redirect to dashboard

---

## 🐛 Troubleshooting

### "Database connection error"
- Check `DATABASE_URL` environment variable is set correctly
- Verify database is accessible from Vercel
- Check database allows connections from Vercel IPs

### "CORS error"
- Add your Vercel domain to `CORS_ORIGINS` environment variable
- Or update CORS settings in `api/index.js`

### "401 Unauthorized" on login
- Check `JWT_SECRET` is set
- Verify users exist in database
- Check server logs in Vercel dashboard

### "Function timeout"
- Vercel free tier has 10s timeout
- Upgrade to Pro for longer timeouts
- Optimize slow endpoints

---

## 📝 File Structure for Vercel

```
dubai-logistics-system/
├── api/
│   └── index.js          # Serverless function entry point
├── src/
│   ├── server/           # Backend code
│   └── ...               # Frontend code
├── vercel.json           # Vercel configuration
├── package.json
└── ...
```

---

## ✅ Summary Checklist

- [ ] Git repository initialized
- [ ] Code pushed to GitHub
- [ ] Vercel account created
- [ ] Project deployed to Vercel
- [ ] Environment variables set (DATABASE_URL, JWT_SECRET, etc.)
- [ ] Production database set up
- [ ] Database migrations run
- [ ] Users created in production database
- [ ] Frontend accessible
- [ ] Backend API accessible (`/api/health`)
- [ ] Login works

---

## 🎉 You're Done!

Your application is now live on Vercel with:
- ✅ Frontend deployed (static)
- ✅ Backend deployed (serverless functions)
- ✅ Database connected
- ✅ Authentication working

**Next Steps:**
- Set up custom domain (optional)
- Configure CI/CD for auto-deployment
- Set up monitoring and logging
- Add more environment-specific configurations

